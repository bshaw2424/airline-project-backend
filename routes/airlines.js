const express = require("express");
const Router = express.Router({ mergeParams: true });
const routes = require("../controllers/airlines");

Router.get("/", routes.index);
Router.get("/new", routes.newAirline);
Router.post("/", routes.post);
Router.get("/:slug", routes.showPage);
Router.get("/:slug/edit", routes.edit);
Router.put("/:slug", routes.update);
Router.delete("/:slug", routes.delete);

module.exports = Router;
