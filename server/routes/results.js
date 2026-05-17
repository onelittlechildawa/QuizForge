import express from 'express';
import { asyncRoute, AppError } from '../errors.js';
import { getResult } from '../db.js';

export const resultsRouter = express.Router();

resultsRouter.get('/results/:rid', asyncRoute(async (req, res) => {
  const result = getResult(req.params.rid);
  if (!result) {
    throw new AppError(404, '没有找到这个结果。');
  }
  res.json({ result });
}));
