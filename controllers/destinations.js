const Airlines = require("../models/airlines");
const Destinations = require("../models/destinations");

module.exports.index = async (req, res) => {
  const { slug } = req.params;
  const destinations = await Airlines.findOne({ slug }).populate(
    "destinations",
  );
  res.render("destinations/index", { destinations });
};

module.exports.new = async (req, res) => {
  const { slug } = req.params;
  const destinations = await Airlines.findOne({ slug });
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
  const destinations = await Destinations.findOne({ destination });
  res.render("destinations/showPage", { showPage, destinations });
};

module.exports.edit = async (req, res) => {
  const { slug } = req.params;
  const airlines = await Airlines.findOne({ slug: slug });
  res.render("destinations/edit", { airlines });
};

module.exports.update = async (req, res) => {
  const { slug } = req.params;
  const { Airline } = req.body;
  const airline = await Airlines.findOneAndUpdate(
    {
      slug: slug,
    },
    { ...Airline },
    {
      new: true,
    },
  );
  await airline.save();
  res.redirect("/");
};

module.exports.delete = async (req, res) => {
  const { slug } = req.params;
  await Airlines.findOneAndDelete({ slug: slug });
  res.redirect("/airlines");
};
