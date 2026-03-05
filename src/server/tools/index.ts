/**
 * server/tools/index.ts
 * Ponto central de exportação dos tool builders (P-07).
 * Cada builder recebe um ToolContext com userId/chatId da request.
 */

export { buildProposeSearchSolDatabaseTool, buildProposeSearchGlobalDatabaseTool } from './propose-search';
export type { ToolContext } from './propose-search';
export { buildAddArticleByDoiTool } from './add-article';
export { buildGenerateSystematicReviewTool } from './generate-review';
