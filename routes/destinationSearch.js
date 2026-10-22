
const express = require("express");
const Router = express.Router();

const destinationApi = require("../controllers/destinationApi");

Router.get("/search", destinationApi.searchDestinations);

module.exports = Router;
