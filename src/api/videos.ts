import { type BunRequest } from "bun";
import { randomBytes } from "crypto";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
    if (!videoId) {
      throw new BadRequestError("Invalid video ID");
    }
  
    const token = getBearerToken(req.headers);
    const userID = validateJWT(token, cfg.jwtSecret);
  
    console.log("uploading video", videoId, "by user", userID);
  
    const formData = await req.formData();
    const file = formData.get("video");
    if (!(file instanceof File)) {
      throw new BadRequestError("Video file missing");
    } 
  
    const MAX_UPLOAD_SIZE = 1 << 30; // 1GB
    if(file.size > MAX_UPLOAD_SIZE) {
      throw new BadRequestError("File size cannot be greater than 1GB");
    }
  
    const video = getVideo(cfg.db, videoId);
    if (!video) {
      throw new NotFoundError("Couldn't find video");
    }
  
    if (userID !== video.userID) {
      throw new UserForbiddenError("You don't have permission to edit this video");
    }
  
    const mimeType = file.type;
    if (mimeType !== "video/mp4") {
      throw new BadRequestError("File type needs to be jpg or png");
    }
  
    const filename = randomBytes(32).toString("base64url");
    const fileExtension = mimeType.split("/")[1];
    const key = `${filename}.${fileExtension}`;

    const bucket = cfg.s3Client.file(key);
    await bucket.write(file, {
      type: mimeType,
    })
    const url = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
  
    video.videoURL = url;
    updateVideo(cfg.db, video);
  
    return respondWithJSON(200, video);
}
