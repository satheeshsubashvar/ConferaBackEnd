import { Router } from 'express';
import { upload, uploadDocument, uploadVideo, buildUploadUrl } from '../middleware/upload.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// POST /api/uploads/image - accepts a single image file under the
// form field "file", returns its public URL. Used by both the Basic
// Information logo field and the App Branding logo/banner fields.
router.post('/image', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // Multer errors (file too large, wrong type) surface here with
      // a readable message rather than a generic 500.
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }

    const url = buildUploadUrl(req.file.filename);
    res.status(201).json({
      url,
      filename: req.file.filename,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
    });
  });
});


// POST /api/uploads/video - MP4/WebM/OGG, 50MB max.
router.post('/video', (req, res) => {
  uploadVideo.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video was uploaded.' });
    res.status(201).json({
      url: buildUploadUrl(req.file.filename),
      filename: req.file.filename,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
    });
  });
});

// POST /api/uploads/document - PDF/PPTX only, 10MB max, per the
// Session Manager "Documents" section reference.
router.post('/document', (req, res) => {
  uploadDocument.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }

    const url = buildUploadUrl(req.file.filename);
    res.status(201).json({
      url,
      filename: req.file.filename,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
    });
  });
});

export default router;
