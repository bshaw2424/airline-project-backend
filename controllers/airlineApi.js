const Airlines = require("../models/airlines");

// GET - All airlines
module.exports.index = async (req, res) => {
  try {
    const airlines = await Airlines.find();

    return res.status(200).json(airlines);
  } catch (error) {
    console.error("Error fetching airlines:", error);

    return res.status(500).json({
      message: "Unable to fetch airlines.",
    });
  }
};

// GET - All airlines with destinations
module.exports.destinationIndex = async (req, res) => {
  try {
    const airlineDestinations = await Airlines.find({}).populate({
      path: "destinations",
    });

    return res.status(200).json(airlineDestinations);
  } catch (error) {
    console.error("Error fetching airline destinations:", error);

    return res.status(500).json({
      message: "Unable to fetch airline destinations.",
    });
  }
};

// GET - Individual airline with destinations
module.exports.showPage = async (req, res) => {
  try {
    const { slug } = req.params;

    const destinations = await Airlines.findOne({ slug }).populate(
      "destinations",
    );

    if (!destinations) {
      return res.status(404).json({
        message: "Airline not found.",
      });
    }

    return res.status(200).json(destinations);
  } catch (error) {
    console.error("Error fetching airline:", error);

    return res.status(500).json({
      message: "Unable to fetch airline.",
    });
  }
};
