#!/usr/bin/env node
import { run } from './openpmm.js'

process.exitCode = await run()
