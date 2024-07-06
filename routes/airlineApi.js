const express = require("express");
const Router = express.Router({ mergeParams: true });
const routes = require("../controllers/airlineApi");

Router.get("/", routes.index);
Router.get("/info", routes.destinationIndex);
Router.get("/destinations", routes.showPage);

module.exports = Router;
