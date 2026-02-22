import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";


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
    throw new UserForbiddenError("Yo don't have permission to edit this video");
  }

  const arrayBuffer = await file.arrayBuffer();
  const fileExtension = file.type.split("/")[1];
  const path = `${cfg.assetsRoot}/${video.id}.${fileExtension}`;
  await Bun.write(path, arrayBuffer);
  const url = `http://localhost:${cfg.port}/assets/${video.id}.${fileExtension}`;

  video.thumbnailURL = url;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
