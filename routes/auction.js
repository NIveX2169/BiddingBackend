import express from "express";
import {
  createAuction,
  deleteAuction,
  getAllAuctions,
  getAllAuctionsByUser,
  getAuctionById,
  updateAuction,
} from "../controller/auction/auction.js";
import { verifyToken } from "../middleware/verifyTokenMiddleware.js";

const router = express.Router();
router.route("/get-specific-auctions").get(verifyToken, getAllAuctionsByUser);

router.route("/").post(createAuction).get(verifyToken, getAllAuctions);

router
  .route("/:auctionId")
  .get(getAuctionById)
  .delete(deleteAuction)
  .patch(verifyToken, updateAuction);

export const AuctionRoutes = router;
