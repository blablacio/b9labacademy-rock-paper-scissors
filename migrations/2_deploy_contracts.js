const RockPaperScissors = artifacts.require("RockPaperScissors");

module.exports = function(deployer) {
  deployer.deploy(RockPaperScissors, 10000, 600, false);
};
