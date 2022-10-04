const express = require("express");
const Router = express.Router({ mergeParams: true });
const routes = require("../controllers/destinations");

Router.get("/", routes.index);
Router.get("/new", routes.new);
Router.post("/", routes.post);
Router.get("/:destination/edit", routes.edit);
Router.put("/:destination", routes.update);
Router.delete("/:destination", routes.delete);

module.exports = Router;
