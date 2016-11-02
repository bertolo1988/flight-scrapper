const debug = require('debug')('momondo-scrappper');
var chromedriver = require('chromedriver');
var MomondoQueryString = require('../src/momondo-query-string');
var MomondoFlightBuilder = require('../src/momondo-flight-builder');
var Utils = require('../src/utils');
var Webdriver = require('selenium-webdriver');
var By = Webdriver.By;
var fs = require('fs');
var path = require('path');

function momondoScrappper() {

    const SCRAPPED_VALUES = 11;
    let browser;
    let chromedriverArgs;
    let driver;

    function startBrowser(browserName, cdriverArgs) {
        browser = browserName || browser;
        chromedriverArgs = cdriverArgs || chromedriverArgs;
        chromedriver.start(chromedriverArgs);
        driver = new Webdriver.Builder()
            .forBrowser(browser)
            .build();
    }

    function stopBrowser() {
        driver.quit();
        chromedriver.stop();
    }

    function parseFlightPromises(args, date, dateFormat, from, to) {
        if (args.length != null && args.length % SCRAPPED_VALUES != 0) {
            throw new Error('Invalid number of scrapped values!');
        }
        let result = [];
        for (let i = 0; i + SCRAPPED_VALUES <= args.length; i += SCRAPPED_VALUES) {
            result.push(MomondoFlightBuilder.buildFlight(i, args, date, dateFormat, from, to));
        }
        return result;
    }

    function retrieveFlightPromises(elements) {
        var resultBoxData = [];
        elements.forEach((element) => {
            //airline
            resultBoxData.push(element.findElement(By.css('div.names')).getText());
            //amount
            resultBoxData.push(element.findElement(By.css('div.price-pax .price span.value')).getText());
            //currency
            resultBoxData.push(element.findElement(By.css('div.price-pax .price span.unit')).getText());
            //departure time
            resultBoxData.push(element.findElement(By.css('div.departure > div > div.iata-time > span.time')).getText());
            //arrival time
            resultBoxData.push(element.findElement(By.css('div.destination > div > div.iata-time > span.time')).getText());
            //days later
            resultBoxData.push(element.findElement(By.css('div.destination > div > div.iata-time > span.days-later')).getText().catch(() => {
                return Promise.resolve(0);
            }));
            //airport from
            resultBoxData.push(element.findElement(By.css('div.departure > div > div.iata-time > span.iata')).getText());
            //airport to
            resultBoxData.push(element.findElement(By.css('div.destination > div > div.iata-time > span.iata')).getText());
            //duration
            resultBoxData.push(element.findElement(By.css('.travel-time')).getText());
            //stops
            resultBoxData.push(element.findElement(By.css('div.travel-stops > .total')).getText());
            //class
            resultBoxData.push(element.findElement(By.css('div.info div.class')).getText());
        });
        return resultBoxData;
    }

    function buildUrl(fromAeroport, toAeroport, targetDate, currency, directFlight) {
        let momondo = new MomondoQueryString(fromAeroport, toAeroport, targetDate, currency, directFlight);
        return 'http://www.momondo.co.uk/flightsearch/?' + momondo.toString();
    }

    function filterSucessfullPromises(promisesMap) {
        var results = [];
        for (let p of promisesMap) {
            if (p.success) {
                results.push(p.result);
            }
        }
        return Promise.all(results);
    }

    function allSettled(promises) {
        return Promise.all(
            promises.map(
                (promise) => promise.then(
                    (result) => ({
                        result,
                        success: true
                    }),
                    (result) => ({
                        result,
                        success: false
                    })
                )
            )
        );
    }

    function retrieveFlightData(route, targetDate, dateFormat) {
        let resultsBoardElement = driver.findElement(By.id('results-tickets'));
        let resultBoxElementsPromise = resultsBoardElement.findElements(By.css('div.result-box.standard'));
        let resultBoxDataPromise = resultBoxElementsPromise.then((elements) => {
            if (elements.length > 0) {
                let resultBoxData = retrieveFlightPromises(elements);
                return allSettled(resultBoxData).then((results) => {
                    return filterSucessfullPromises(results);
                });
            } else {
                debug('No data found!');
                return 0;
            }
        });
        return resultBoxDataPromise.then((args) => {
            let flights = parseFlightPromises(args, targetDate, dateFormat, route.from, route.to);
            debug(Utils.prettifyObject(flights.length > 0 ? flights[0] : flights));
            return flights;
        });
    }

    function resizeWindow(maximize) {
        if (maximize) {
            return driver.manage().window().maximize();
        } else {
            return Promise.resolve();
        }
    }

    function retrieveFlightPage(route, targetDate, dateFormat, currency, directFlight, maximize, timeout) {
        return resizeWindow(maximize).then(() => {
            let fullUrl = buildUrl(route.from, route.to, targetDate.format(dateFormat), currency, directFlight);
            let getPromise = driver.get(fullUrl);
            return getPromise.then(() => {
                let inProgressPromise = driver.wait(() => {
                    return driver.findElement(By.id('searchProgressText')).getText().then((text) => {
                        return text === 'Search complete';
                    });
                }, timeout);
                return inProgressPromise.then(() => {
                    return retrieveFlightData(route, targetDate, dateFormat);
                });
            });
        });
    }

    function takeScreenShot(route, targetDate) {
        return driver.takeScreenshot().then((data) => {
            let todayDate = Utils.getTodayDateString('DD-MM-YYYY_HH_mm');
            let imgName = todayDate + '_' + route.from + '_' + route.to + '_' + targetDate + '.png';
            let ssPath = 'screenshots' + path.sep;
            fs.writeFileSync(ssPath + imgName, data, 'base64');
            debug('Screenshot saved at ' + ssPath + imgName + ' !');
        });
    }

    function scrapFlights(route, date, dateFormat, currency, directFlight, maximize, timeout, retries) {
        return retrieveFlightPage(route, date, dateFormat, currency, directFlight, maximize, timeout).catch((error) => {
            debug('Caught an error while trying to retrieve the flights');
            debug(error);
            return takeScreenShot(route, date, dateFormat).then(() => {
                debug('Retrying...');
                return scrapFlights(route, date, dateFormat, currency, directFlight, maximize, timeout, retries - 1);
            }).catch((err) => {
                debug('Failed to take screenshot');
                debug(err);
                stopBrowser();
                startBrowser();
                debug('Retrying...');
                return scrapFlights(route, date, dateFormat, currency, directFlight, maximize, timeout, retries - 1);
            });
        });
    }

    function scrap(args) {
        let route = args.route;
        let date = args.date;
        let dateFormat = args.dateFormat;
        let currency = args.currency;
        let directFlight = args.directFlight;
        let maximize = args.maximize;
        let timeout = args.timeout || 80000;
        let retries = args.retries || 1;
        return scrapFlights(route, date, dateFormat, currency, directFlight, maximize, timeout, retries);
    }

    return {
        scrap,
        startBrowser,
        stopBrowser
    };
}

module.exports = momondoScrappper();