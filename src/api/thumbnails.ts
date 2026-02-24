import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { randomBytes } from "crypto";


export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20; // 10MB
  if(file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size cannot be greater than 10MB");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (userID !== video.userID) {
    throw new UserForbiddenError("You don't have permission to edit this video");
  }

  const mimeType = file.type;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
    throw new BadRequestError("File type needs to be jpg or png");
  }

  const filename = randomBytes(32).toString("base64url");
  const arrayBuffer = await file.arrayBuffer();
  const fileExtension = mimeType.split("/")[1];
  const path = `${cfg.assetsRoot}/${filename}.${fileExtension}`;
  await Bun.write(path, arrayBuffer);
  const url = `http://localhost:${cfg.port}/assets/${filename}.${fileExtension}`;

  video.thumbnailURL = url;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
