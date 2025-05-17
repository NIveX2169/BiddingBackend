import mongoose from "mongoose";

import { AuctionModel } from "../../models/auction.js";
// --- CREATE AUCTION ---
export const createAuction = async (req, res) => {
  try {
    const {
      title,
      description,
      startingPrice,
      startTime,
      endTime,
      category,
      createdBy,
    } = req.body;

    const { userId } = req; // Assuming userId is set by your auth middleware

    if (!title || !description || !startingPrice || !startTime || !endTime) {
      return res.status(400).json({
        status: false,
        message:
          "Missing required fields: title, description, startingPrice, startTime, endTime.",
      });
    }

    if (new Date(endTime) <= new Date(startTime)) {
      return res
        .status(400)
        .json({ status: false, message: "End time must be after start time." });
    }
    if (
      new Date(startTime) < new Date() &&
      new Date(startTime).toDateString() !== new Date().toDateString()
    ) {
      // Allow starting today
      // More robust check might be needed if you allow scheduling for past time on same day
      // For simplicity, let's assume startTime should be in the future or today.
      // return res.status(400).json({ status: false, message: "Start time cannot be in the past." });
    }

    const auctionCreated = await AuctionModel.create({
      title,
      description,
      startingPrice,
      category,
      currentPrice: startingPrice, // Initialize currentPrice with startingPrice
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      createdBy,
      status: new Date(startTime) <= new Date() ? "active" : "pending", // Set status based on startTime
      bids: [],
    });

    if (!auctionCreated) {
      // This case is less likely with .create() if no error is thrown,
      // but good for robustness.
      return res
        .status(500)
        .json({ status: false, message: "Auction Creation Failed !!" });
    }

    res.status(201).json({
      status: true,
      message: "Auction Created Successfully !!",
      data: auctionCreated,
    });
  } catch (err) {
    console.error("Error Occurred in createAuction:", err);
    if (err.name === "ValidationError") {
      return res
        .status(400)
        .json({ status: false, message: err.message, errors: err.errors });
    }
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};

// --- UPDATE AUCTION ---
export const updateAuction = async (req, res) => {
  try {
    const { userId } = req; // From auth middleware
    const { auctionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      return res
        .status(400)
        .json({ status: false, message: "Invalid Auction ID format." });
    }

    const auction = await AuctionModel.findById(auctionId);

    if (!auction) {
      return res
        .status(404)
        .json({ status: false, message: "Auction not found." });
    }

    // Authorization: Only the creator can update (or an admin, if you add that role check)
    if (auction.createdBy.toString() !== userId) {
      // Add admin check: && req.userRole !== 'admin'
      return res.status(403).json({
        status: false,
        message: "Unauthorized: You cannot update this auction.",
      });
    }

    // Prevent updates if auction has started and has bids, or has ended (for certain fields)
    const now = new Date();
    if (
      now >= new Date(auction.startTime) &&
      auction.bids &&
      auction.bids.length > 0
    ) {
      if (
        req.body.startingPrice &&
        req.body.startingPrice !== auction.startingPrice
      ) {
        return res.status(400).json({
          status: false,
          message: "Cannot change starting price after bidding has begun.",
        });
      }
      // Allow updating title, description, imageUrl even if started
    }
    if (
      auction.status === "ended" ||
      auction.status === "sold" ||
      auction.status === "cancelled"
    ) {
      // Allow admin to change status, or very limited updates
      if (req.body.status && req.userRole !== "admin") {
        // Example: only admin can change status of ended auction
        return res.status(403).json({
          status: false,
          message: "Auction has ended and cannot be significantly modified.",
        });
      }
    }

    // Fields that can be updated
    const {
      title,
      description,
      startingPrice,
      startTime,
      endTime,
      category,
      status,
    } = req.body;
    const updateData = {};

    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (category) updateData.category = category;

    // Conditional updates
    if (startingPrice && (!auction.bids || auction.bids.length === 0)) {
      updateData.startingPrice = startingPrice;
      // If starting price changes and no bids, current price should also reset
      if (!auction.bids || auction.bids.length === 0) {
        updateData.currentPrice = startingPrice;
      }
    }
    if (startTime) {
      if (
        new Date(startTime) < now &&
        new Date(startTime).toDateString() !== now.toDateString() &&
        (!auction.bids || auction.bids.length === 0)
      ) {
        // Potentially allow changing start time if no bids yet and it's not too far in past
      }
      updateData.startTime = new Date(startTime);
    }
    if (endTime) {
      if (
        new Date(endTime) <= new Date(updateData.startTime || auction.startTime)
      ) {
        return res.status(400).json({
          status: false,
          message: "End time must be after start time.",
        });
      }
      updateData.endTime = new Date(endTime);
    }
    if (status) {
      // Be careful with status changes, may need specific logic
      // Example: allow admin to cancel or manually end
      if (
        req.userRole === "admin" ||
        (status === "cancelled" &&
          auction.status !== "ended" &&
          auction.status !== "sold")
      ) {
        updateData.status = status;
      } else if (status !== auction.status) {
        return res.status(403).json({
          status: false,
          message: "Not authorized to change status to this value.",
        });
      }
    }

    // Recalculate status if startTime is changed
    if (updateData.startTime) {
      updateData.status =
        new Date(updateData.startTime) <= now ? "active" : "pending";
      if (auction.status === "ended" || auction.status === "sold") {
        // Don't reactivate ended auction by changing start time unless admin
        if (req.userRole !== "admin") delete updateData.status;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        status: false,
        message: "No valid fields provided for update.",
      });
    }

    const updatedAuction = await AuctionModel.findByIdAndUpdate(
      auctionId,
      { $set: updateData },
      { new: true, runValidators: true } // new: true returns the updated document, runValidators ensures schema validation
    ).populate("createdBy", "username email"); // Populate creator info

    if (!updatedAuction) {
      // Should not happen if findById found it, but for safety
      return res.status(404).json({
        status: false,
        message: "Auction not found after update attempt.",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Auction Updated Successfully!",
      data: updatedAuction,
    });
  } catch (err) {
    console.error("Error Occurred in updateAuction:", err);
    if (err.name === "ValidationError") {
      return res
        .status(400)
        .json({ status: false, message: err.message, errors: err.errors });
    }
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};

// --- DELETE AUCTION ---
export const deleteAuction = async (req, res) => {
  try {
    const { userId, userRole } = req; // From auth middleware
    const { auctionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      return res
        .status(400)
        .json({ status: false, message: "Invalid Auction ID format." });
    }

    const auction = await AuctionModel.findById(auctionId);

    if (!auction) {
      return res
        .status(404)
        .json({ status: false, message: "Auction not found." });
    }

    // Authorization: Only the creator or an admin can delete
    if (auction.createdBy.toString() !== userId && userRole !== "admin") {
      return res.status(403).json({
        status: false,
        message: "Unauthorized: You cannot delete this auction.",
      });
    }

    // Optional: Prevent deletion if bids exist or auction is active/ended,
    // Or mark as 'cancelled' instead of hard delete. For now, direct delete.
    if (auction.bids && auction.bids.length > 0 && userRole !== "admin") {
      // return res.status(400).json({ status: false, message: "Cannot delete auction with active bids. Consider cancelling." });
    }

    await AuctionModel.findByIdAndDelete(auctionId);

    return res
      .status(200)
      .json({ status: true, message: "Auction Deleted Successfully!" });
  } catch (err) {
    console.error("Error Occurred in deleteAuction:", err);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};

// --- GET ALL AUCTIONS (Conditional based on role) ---

export const getAllAuctions = async (req, res) => {
  try {
    const { userId, userRole } = req; // From auth middleware

    // Destructure query parameters with defaults
    const {
      page = 1,
      limit = 10, // Default to 10 items per page
      status, // Specific status filter: 'pending', 'active', 'ended', 'sold', 'cancelled'
      active, // Convenience filter: 'true' (active), 'upcoming', 'ended'
      sortBy = "createdAt", // Default sort field
      order = "desc", // Default sort order
      search, // Search term for title/description
      category, // Filter by category
      sellerId, // Filter by a specific seller's ID (useful for public profiles or admin views)
      // Add more specific filters if needed, e.g., minPrice, maxPrice
    } = req.query;

    let query = {};

    if (search) {
      const searchRegex = new RegExp(search, "i"); // Case-insensitive search
      query.$or = [{ title: searchRegex }, { description: searchRegex }];
    }

    // --- Filtering ---
    if (category) {
      query.category = category;
    }

    if (status) {
      query.status = status;
    } else if (active === "true") {
      // Active auctions: started, not ended, and status is 'active'
      query.status = "active";
      query.startTime = { $lte: new Date() };
      query.endTime = { $gte: new Date() };
    } else if (active === "upcoming") {
      // Upcoming auctions: not yet started, status is 'pending'
      query.status = "pending";
      query.startTime = { $gt: new Date() };
    } else if (active === "ended") {
      // Ended auctions: past endTime or status is 'ended', 'sold', 'cancelled'
      query.$or = [
        { endTime: { $lt: new Date() } },
        { status: { $in: ["ended", "sold", "cancelled"] } },
      ];
    }

    // --- Pagination and Sorting Options ---
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);

    const options = {
      page: parsedPage > 0 ? parsedPage : 1,
      limit: parsedLimit > 0 ? parsedLimit : 10,
      sort: { [sortBy]: order === "asc" ? 1 : -1 },
      populate: [
        { path: "createdBy", select: "username email _id" },
        { path: "highestBidder", select: "username _id" },
      ],
      lean: true,
    };

    // --- Fetch Data ---
    const result = await AuctionModel.paginate(query, options);

    return res.status(200).json({
      status: true,
      message: "Auctions fetched successfully!",
      data: result.docs,
      totalPages: result.totalPages,
      currentPage: result.page,
      totalAuctions: result.totalDocs,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
    });
  } catch (err) {
    console.error("Error Occurred in getAllAuctions:", err);
    // More specific error handling can be added here
    if (err.name === "CastError") {
      return res.status(400).json({
        status: false,
        message: "Invalid parameter format.",
        error: err.message,
      });
    }
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};

export const getAllAuctionsByUser = async (req, res) => {
  try {
    const loggedInUserId = req.user.id;
    const loggedInUserRole = req.user.role;
    console.log("asdad", req.user);
    const {
      page = 1,
      limit = 10,
      status,
      active, // 'true' (active), 'upcoming', 'past' (combines ended, sold, cancelled)
      sortBy = "createdAt",
      order = "desc",
      search,
      category,
    } = req.query;

    let query = {};

    // --- Determine Base Query Based on Role ---
    if (loggedInUserRole == "ADMIN") {
    } else {
      query.createdBy = loggedInUserId;
    }

    // --- Apply Common Filters ---
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [{ title: searchRegex }, { description: searchRegex }];
    }

    if (category) {
      query.category = category;
    }

    // --- Status and Active Filters ---
    if (status) {
      // If a specific status is provided, use it directly
      query.status = status;
    } else if (active) {
      // Apply convenience 'active' filter
      const now = new Date();
      if (active === "true") {
        // Renamed from 'active' to 'true' for clarity, or use 'live'
        query.status = "active";
        // query.startTime = { $lte: now }; // Implicit if status is already 'active' due to cron
        // query.endTime = { $gte: now };   // Implicit if status is already 'active'
      } else if (active === "upcoming") {
        query.status = "pending";
        query.startTime = { $gt: now };
      } else if (active === "past") {
        // 'past' combines ended, sold, cancelled
        query.$or = [
          ...(query.$or || []), // Preserve existing $or conditions if any (like search)
          { endTime: { $lt: now }, status: { $in: ["active", "pending"] } }, // Active/pending but endTime passed
          { status: { $in: ["ended", "sold", "cancelled"] } }, // Already marked as ended/sold/cancelled
        ];
        if (query.$or.length === 0) delete query.$or;
      }
    }

    // --- Pagination and Sorting Options ---
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);

    const options = {
      page: parsedPage > 0 ? parsedPage : 1,
      limit: parsedLimit > 0 ? parsedLimit : 10,
      sort: { [sortBy]: order === "asc" ? 1 : -1 },
      populate: [
        { path: "createdBy", select: "username email _id" },
        { path: "highestBidder", select: "username email _id" },
      ],
      lean: true,
    };

    console.log("query", query);
    const result = await AuctionModel.paginate(query, options);

    return res.status(200).json({
      status: true,
      message: "Auctions fetched successfully!",
      data: result.docs,
      totalPages: result.totalPages,
      currentPage: result.page,
      totalAuctions: result.totalDocs,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
    });
  } catch (err) {
    console.error("Error Occurred in getAllAuctionsByUser:", err);
    if (err.name === "CastError" && err.path === "_id") {
      // More specific CastError check
      return res.status(400).json({
        status: false,
        message: "Invalid ID format provided for a filter (e.g., sellerId).",
        error: err.message,
      });
    }
    if (err.name === "CastError") {
      return res.status(400).json({
        status: false,
        message: "Invalid parameter format.",
        error: err.message,
      });
    }
    return res.status(500).json({
      status: false,
      message: "Internal Server Error while fetching auctions.",
      error: err.message,
    });
  }
};
// --- GET AUCTION BY ID ---
export const getAuctionById = async (req, res) => {
  try {
    const { auctionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      return res
        .status(400)
        .json({ status: false, message: "Invalid Auction ID format." });
    }

    const auction = await AuctionModel.findById(auctionId)
      .populate("createdBy", "username email _id")
      .populate("bids.bidder", "username _id")
      .populate("highestBidder", "username _id")
      .lean();

    if (!auction) {
      return res
        .status(404)
        .json({ status: false, message: "Auction not found." });
    }

    return res.status(200).json({
      status: true,
      message: "Auction details fetched!",
      data: auction,
    });
  } catch (err) {
    console.error("Error Occurred in getAuctionById:", err);
    return res.status(500).json({
      status: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};
