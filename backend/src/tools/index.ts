/**
 * Tool registry
 * Exports all tools for the Agent SDK
 */

export { buildAdSkeleton, buildAdSkeletonSchema } from './build-ad-skeleton.js';
export { addText, addTextSchema } from './add-text.js';
export { getFrameState, getFrameStateSchema } from './get-frame-state.js';
export { setBackground, setBackgroundSchema } from './set-background.js';
export { addEffect, addEffectSchema } from './add-effect.js';
export { getCanvasScreenshot, getCanvasScreenshotSchema } from './get-canvas-screenshot.js';
export { rawFigmaOperation, rawFigmaOperationSchema } from './raw-figma-operation.js';
export { placeProduct, placeProductSchema } from './place-product.js';
export { applyTypography, applyTypographySchema } from './apply-typography.js';
export { trimTransparentPixels, getImageDimensions } from './image-analysis.js';
export { updateNode, updateNodeSchema } from './update-node.js';
export { deleteNode, deleteNodeSchema } from './delete-node.js';
export { createShape, createShapeSchema } from './create-shape.js';
export { duplicateFrame, duplicateFrameSchema } from './duplicate-frame.js';
export { exportAd, exportAdSchema } from './export-ad.js';
export { completeConcept, completeConceptSchema } from './complete-concept.js';
export { logLearning, logLearningSchema } from './log-learning.js';
export { readBrandData, readBrandDataSchema } from './read-brand-data.js';
export { browseAdLibrary, browseAdLibrarySchema } from './browse-ad-library.js';
export { reorderChildren, reorderChildrenSchema } from './reorder-children.js';

// Phase 4: Batch operations
export { batchUpdate, batchUpdateSchema } from './batch-update.js';
export { saveCheckpoint, saveCheckpointSchema, restoreCheckpoint, restoreCheckpointSchema, listCheckpoints, listCheckpointsSchema, clearCheckpoints } from './checkpoint.js';

// Phase 5a: Batch pipeline + DSL operations
export { batchPipeline, batchPipelineSchema } from './batch-pipeline.js';
export { batchOperations, batchOperationsSchema } from './batch-operations.js';
export { parseDSL } from './dsl-parser.js';

// Phase 5a: Template library
export { saveTemplate, saveTemplateSchema } from './template-library.js';
export { browseTemplates, browseTemplatesSchema } from './template-library.js';
export { applyTemplate, applyTemplateSchema } from './template-library.js';

// Phase 3b: Asset generation tools
export { generateProductPhoto, generateProductPhotoSchema } from './generate-product-photo.js';
export { generateAsset, generateAssetSchema } from './generate-asset.js';
export { removeBackground, removeBackgroundSchema } from './remove-background.js';
export { estimateCost, estimateCostSchema } from './estimate-cost.js';
