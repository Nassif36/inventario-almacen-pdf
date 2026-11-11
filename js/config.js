export const APP_CONFIG = Object.freeze({
  name: 'El Hornero Market',
  databaseName: 'el-hornero-delta',
  databaseVersion: 3,
  schemaVersion: 1,
  defaultInventoryKey: 'validatedInventoryState',
  defaultInventoryRevisionKey: 'validatedInventoryRevision',
  defaultInventoryRevision: '2026-11-11-413',
  photoUpdateKey: 'validatedPhotoBatch',
  photoUpdateVersion: '2026-11-11-opt388',
  maxImageBytes: 5 * 1024 * 1024,
  supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  catalogContact: Object.freeze({
    address: 'Arroyo Abra Vieja, 360',
    whatsapp: '+54 9 11 6893-6322'
  })
});
