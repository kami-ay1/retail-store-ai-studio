import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { resolve } from 'node:path'
import { z } from 'zod'
import { dataDirectory } from './config.ts'

/** 中文商品检索固定使用同一模型、版本和向量维度。 */
export const productEmbedding = {
  model: 'Xenova/bge-small-zh-v1.5',
  revision: '7a21cfa835a0d8cba006e36210e7843b232a1107',
  dimensions: 512,
} as const

env.cacheDir = resolve(dataDirectory, 'models')
env.allowLocalModels = false
let extractor: Promise<FeatureExtractionPipeline> | undefined
const vectorsSchema = z.array(z.array(z.number().finite()).length(productEmbedding.dimensions))

/** 在本机 CPU 上生成中文语义向量，商品文本不会提交给外部推理服务。 */
export async function embedProductTexts(texts: string[], isQuery = false) {
  if (!texts.length) return []
  extractor ??= pipeline('feature-extraction', productEmbedding.model, {
    revision: productEmbedding.revision, dtype: 'q8', device: 'cpu',
  }).then(value => value, (error: unknown) => { extractor = undefined; throw error })
  const model = await extractor
  const inputs = isQuery ? texts.map(text => `为这个句子生成表示以用于检索相关文章：${text}`) : texts
  const output = await model(inputs, { pooling: 'cls', normalize: true })
  return vectorsSchema.parse(output.tolist())
}
