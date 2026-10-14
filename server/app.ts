import { createRequestHandler } from '@react-router/express'
import express from 'express'

export const app = express()

// Given a function, React Router re-derives the route tree (one regex per
// route, over a hundred routes) on every request, which the development
// server needs for a fresh build on each change. Production resolves the build
// once and hands over the object.
const loadBuild = () => import('virtual:react-router/server-build')

app.use(
	createRequestHandler({
		mode: process.env.NODE_ENV ?? 'development',
		build:
			process.env.NODE_ENV === 'production' ? await loadBuild() : loadBuild,
	}),
)
