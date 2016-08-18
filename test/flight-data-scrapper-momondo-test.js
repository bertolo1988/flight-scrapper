var FlightScrapper = require('../dist/flight-scrapper');
var Config = require('../config');
require('should');

describe('FlightScrapper tests', function() {
  this.timeout(Config.TIMEOUT);

  it('should retrieve 15 results', (done) => {
    FlightScrapper.run().then((resp) => {
      resp.should.be.exactly(15);
      done();
    });
  });

  it('should get "No results" error', (done) => {
    FlightScrapper.run(['to=PHI']).then({}, (err) => {
      (err instanceof Error).should.be.true();
      done();
    });
  });
});