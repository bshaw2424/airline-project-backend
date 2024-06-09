const Airlines = require("../models/airlines");
const Destinations = require("../models/destinations");
const mongoose = require("mongoose")

module.exports.index = async (req, res) => {
  const { slug } = req.params;
  const destinations = await Airlines.findOne({ slug }).populate(
    "destinations",
  );
  // Sort the populated destinations by a specific field, e.g., 'name'
  const sortedDestinations = destinations.destinations.sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  res.render("destinations/index", { sortedDestinations });
};

module.exports.new = async (req, res) => {
  const { slug } = req.params;
  const destinations = await Airlines.findOne({ slug: slug });
  res.render("destinations/new", { destinations });
};

module.exports.post = async (req, res) => {
  const { Destination } = req.body;
  const { slug } = req.params;

  const airline = await Airlines.findOne({ slug });
  const newDestination = new Destinations(Destination);
  // post to parent's destination array
  airline.destinations.push(newDestination);

  await newDestination.save();
  await airline.save();
  res.redirect(`/airlines/${slug}`);
};

module.exports.showPage = async (req, res) => {
  const { slug, destination } = req.params;
  const showPage = await Airlines.findOne({ slug });
  const destinations = await Destinations.findOne({ slug: destination });

  res.render("destinations/showPage", { showPage, destinations });
};

module.exports.edit = async (req, res) => {
  const { slug, destination } = req.params;
  const destinations = await Destinations.findOne({ slug: destination });
  const airlines = await Airlines.findOne({ slug });
  res.render("destinations/edit", { destinations, airlines });
};

module.exports.update = async (req, res) => {
  const { slug, destination } = req.params;
  const { Destination } = req.body;
  const updateAirlineDestination = await Destinations.findOneAndUpdate(
    {
      slug: destination,
    },
    { ...Destination },
    {
      new: true,
    },
  );
  await updateAirlineDestination.save();
  res.redirect(`/airlines/${slug}`);
};

module.exports.delete = async (req, res) => {
const { slug, destination } = req.params;
try {

  // get ObjectId of target destinations looking to remove from array
  const destinationObjectId = mongoose.Types.ObjectId(destination);

  // Find the airline and remove the destinations from the destinations array
  const updatedAirline = await Airlines.findOneAndUpdate(
    { slug: slug },
    { $pull: { destinations: destinationObjectId } },
    { new: true } // returns updated document
  );

  if (!updatedAirline) {
    return res.status(404).send('Airline not found');
  }

  res.redirect(`/airlines/${slug}`);
} catch (error) {
  console.error('Error in delete:', error);
  res.status(500).send('Internal Server Error');
}

};
