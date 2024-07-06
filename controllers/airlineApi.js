const Airlines = require("../models/airlines");

module.exports.index = async (req, res) => {
  try {
    const airlines = await Airlines.find();

    res.json(airlines);
  } catch (error) {
    console.log(error);
  }
};

module.exports.destinationIndex = async (req, res) => {
  try {
    const airlineDestinations = await Airlines.find({}).populate({
      path: "destinations",
    });
    res.json(airlineDestinations);
  } catch (error) {
    console.log(error);
  }
};

module.exports.showPage = async (req, res) => {
  try {
    const { slug } = req.params;
    const destinations = await Airlines.findOne({ slug }).populate(
      "destinations",
    );
    res.json(destinations);
  } catch (error) {
    console.log(error);
  }
};
