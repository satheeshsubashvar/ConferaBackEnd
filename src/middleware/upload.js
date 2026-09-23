import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
]);
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB, per reference: "10 MB maximum per file"

const ALLOWED_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB for sponsor/event videos

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Only JPEG, PNG, and WEBP images are allowed.'));
  }
  cb(null, true);
}

function videoFileFilter(req, file, cb) {
  if (!ALLOWED_VIDEO_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Only MP4, WebM, and OGG videos are allowed.'));
  }
  cb(null, true);
}

function documentFileFilter(req, file, cb) {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Only PDF and PPTX files are allowed.'));
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

export const uploadDocument = multer({
  storage,
  fileFilter: documentFileFilter,
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
});

export const uploadVideo = multer({
  storage,
  fileFilter: videoFileFilter,
  limits: { fileSize: MAX_VIDEO_SIZE_BYTES },
});

// Builds the public URL for an uploaded file.
//
// Previously this always used UPLOADS_BASE_URL from .env. That works
// for exactly one environment at a time — whichever URL is written in
// the committed .env file — so running the backend on localhost while
// .env still has the production Render URL silently produced broken
// image URLs (uploaded files existed on disk locally, but every URL
// pointed at production, which doesn't have them).
//
// Fix: derive the base URL from the incoming request by default —
// whatever host actually served this request is, by definition, the
// right host for the files it serves. This is correct on localhost,
// correct in production, and correct for anyone else who clones this
// and runs it somewhere else, with zero .env editing.
//
// UPLOADS_BASE_URL remains supported as an explicit override, for
// cases where files are served from a different host than the API
// itself (e.g. a CDN or object storage domain in front of /uploads).
// Leave it unset (or delete it from .env) to get the automatic,
// request-based behavior described above.
export function buildUploadUrl(filename, req) {
  const override = process.env.UPLOADS_BASE_URL;
  if (override) {
    return `${override.replace(/\/$/, '')}/${filename}`;
  }
  if (req) {
    return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
  }
  return `http://localhost:${process.env.PORT || 4000}/uploads/${filename}`;
}
