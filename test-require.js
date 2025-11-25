try {
  console.log('Node version', process.version);
  const p = require.resolve('multer');
  console.log('multer resolved to:', p);
  const m = require('multer');
  console.log('multer required OK, keys:', Object.keys(m).slice(0,5));
} catch(e) {
  console.error('require failed:', e && e.message);
  process.exit(1);
}
