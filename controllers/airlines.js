const airlinesController = require("../models/airlines");

module.exports.index = async (req, res) => {
  res.render("destinations");
};

module.exports.newAirline = async (req, res) => {
  res.render("airlines/new");
};

module.exports.post = async (req, res) => {};
