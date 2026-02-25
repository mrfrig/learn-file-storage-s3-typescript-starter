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
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size cannot be greater than 1GB");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (userID !== video.userID) {
    throw new UserForbiddenError(
      "You don't have permission to edit this video",
    );
  }

  const mimeType = file.type;
  if (mimeType !== "video/mp4") {
    throw new BadRequestError("File type needs to be jpg or png");
  }

  const filename = randomBytes(32).toString("base64url");
  const fileExtension = mimeType.split("/")[1];
  const path = `${cfg.tempRoot}/${filename}.${fileExtension}`;
  await Bun.write(path, file);
  const aspectRatio = await getVideoAspectRatio(path);
  const tempFile = Bun.file(path);
  await tempFile.delete();
  const key = `${aspectRatio}/${filename}.${fileExtension}`;

  const bucket = cfg.s3Client.file(key);
  await bucket.write(file, {
    type: mimeType,
  });
  const url = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;

  video.videoURL = url;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}

async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    { stderr: "pipe" },
  );
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  if ((await proc.exited) !== 0) {
    throw new Error(stderrText);
  }

  const {
    streams: [{ width, height }],
  }: { streams: [{ width: number; height: number }] } = JSON.parse(stdoutText);

  const ratio = width / height;
  const landscape = 16 / 9;
  const portrait = 9 / 16;
  const epsilon = 0.05;

  if (Math.abs(ratio - landscape) < epsilon) {
    return "landscape";
  }

  if (Math.abs(ratio - portrait) < epsilon) {
    return "portrait";
  }

  return "other";
}
