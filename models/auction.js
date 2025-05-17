import mongoose from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const bidSchema = new mongoose.Schema(
  {
    bidder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    // timestamp: {
    //   type: Date,
    //   default: Date.now,
    // },
  },
  {
    timestamps: true,
  }
);

const auctionSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    title: {
      type: String,
      required: [true, "Auction Title Is Required Field !!"],
    },
    description: {
      type: String,
      required: [true, "Description  Is Required Field !!"],
    },
    category: {
      type: String,
      required: [true, "Category Is Required Field !!"],
    },
    startingPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    currentPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    highestBidder: {
      // Denormalized for quick access
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    startTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "active", "ended", "sold", "cancelled"],
      default: "pending",
    },
    bids: [bidSchema],
  },
  {
    timestamps: true,
  }
);

auctionSchema.pre("save", function (next) {
  if (this.isNew && this.currentPrice === undefined) {
    this.currentPrice = this.startingPrice;
  }
  next();
});

auctionSchema.methods.addBid = async function (userId, bidAmount) {
  if (new Date() > this.endTime) {
    throw new Error("Auction has ended.");
  }
  if (new Date() < this.startTime) {
    throw new Error("Auction has not started yet.");
  }
  if (bidAmount <= this.currentPrice) {
    throw new Error("Bid must be higher than the current price.");
  }

  this.bids.push({ bidder: userId, amount: bidAmount, timestamp: new Date() });
  this.currentPrice = bidAmount;
  this.highestBidder = userId;
  this.status = "active";
  return this.save();
};

auctionSchema.plugin(mongoosePaginate);

export const AuctionModel = mongoose.model("Auction", auctionSchema);
