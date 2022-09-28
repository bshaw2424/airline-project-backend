const express = require("express");
const app = express();
const path = require("path");
const airlineRoutes = require("./routes/airlines");
//const destinations = require("./controllers/destinations");
require("./databaseConnect");
const PORT = process.env.port || 8000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views"));

app.use("/", airlineRoutes);

app.listen(PORT, () => console.log(`server running on port ${PORT}`));
