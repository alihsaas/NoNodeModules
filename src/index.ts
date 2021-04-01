import { Octokit } from "@octokit/rest"
import { config } from "dotenv";
import { writeFileSync, readFileSync } from "fs"
import { sleep } from "./utility.js"
import { createPullRequest } from "./create_pull_request.js"

config()

const processed: {
	contain: string[],
	dont_contain: string[],
	page: number
} = JSON.parse(readFileSync("processed.json").toString())

const TOKEN = process.env.TOKEN

if (!TOKEN) {
	throw "A github authentication TOKEN must be added to your root .env file, to access higher request limits"
}

const app = new Octokit({
	auth: TOKEN
})

async function getRepos(page = 1) {
	console.log(`SEARCH PAGE ${page}`)
	const result = await app.request("GET /search/code", {
		"q": "path:node_modules",
		"page": page
	})
	console.log(`FOUND ${result.data.total_count}: ${result.data.items.length}`)
	for (const foundFile of result.data.items) {
		const repoResponse = await app.repos.get({
			owner: foundFile.repository.owner.login,
			repo: foundFile.repository.name
		})
		const repo = repoResponse.data
		console.log(repo.full_name, repo.default_branch)
		if (!processed.contain.includes(repo.full_name) && !processed.dont_contain.includes(repo.full_name)) {
			try {
				const contentResponse = await app.repos.getContent({
					owner: repo.owner!.login,
					repo: repo.name,
					path: ""
				})
				const content = contentResponse.data
				if (content instanceof Array) {
					const containsNodeModules = content.find(item => {
						return item.name === "node_modules"
					})
					if (containsNodeModules) {
						console.log(repo.full_name, repo.size)
						processed.contain.push(repo.full_name)
						try {
							await createPullRequest(app, repo.owner!.login, repo.name, {
								repoContent: contentResponse,
								repoInformation: repoResponse
							})
						} catch {
							await createPullRequest(app, repo.owner!.login, repo.name, {
								repoContent: contentResponse,
								repoInformation: repoResponse
							})
						}
					} else {
						processed.dont_contain.push(repo.full_name)
					}
				}
			} catch(err) {
				console.log(err)
				await sleep(61)
				getRepos(page)
				return
			} finally {
				writeFileSync("processed.json", JSON.stringify(processed))
			}
			await sleep(61)
		}
	}
	await sleep(10)
	processed.page++
	writeFileSync("processed.json", JSON.stringify(processed))
	getRepos(processed.page)
	return
}

getRepos(processed.page)
