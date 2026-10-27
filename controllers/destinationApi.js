const Destination = require("../models/destinations");

// GET /api/destinations/search?q=phoenix
module.exports.searchDestinations = async (req, res) => {
  try {
    const query = req.query.q;

    if (typeof query !== "string") {
      return res.status(400).json({
        message: "A valid search query is required.",
      });
    }

    const search = query.trim();

    if (search.length < 2 || search.length > 100) {
      return res.status(400).json({
        message: "Search must contain between 2 and 100 characters.",
      });
    }

    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escapedSearch, "i");

    const destinations = await Destination.aggregate([
      {
        $match: {
          $or: [
            { name: regex },
            { city: regex },
            { state: regex },
            { airport_name: regex },
            { airport_code: regex },
          ],
        },
      },
      {
        $sort: {
          airport_code: 1,
          _id: 1,
        },
      },
      {
        $group: {
          _id: "$airport_code",
          destination: { $first: "$$ROOT" },
        },
      },
      {
        $replaceRoot: {
          newRoot: "$destination",
        },
      },
      {
        $project: {
          name: 1,
          city: 1,
          state: 1,
          airport_name: 1,
          airport_code: 1,
          international: 1,
        },
      },
      {
        $sort: {
          city: 1,
          airport_code: 1,
        },
      },
      {
        $limit: 20,
      },
    ]);

    return res.status(200).json(destinations);
  } catch (error) {
    console.error("Error searching destinations:", error);

    return res.status(500).json({
      message: "Unable to search destinations.",
    });
  }
};
