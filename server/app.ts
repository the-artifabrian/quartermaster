import { createRequestHandler } from '@react-router/express'
import express from 'express'

export const app = express()

app.use(
	createRequestHandler({
		mode: process.env.NODE_ENV ?? 'development',
		build: () => import('virtual:react-router/server-build'),
	}),
)
