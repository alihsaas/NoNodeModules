import { Octokit, RestEndpointMethodTypes } from "@octokit/rest"

const MODE: Record<string, "100644" | "100755" | "040000" | "160000" | "120000"> = {
	"dir": "040000",
	"file": "100644",
	"executable": "100755",
}

const TYPE: Record<string, "blob" | "tree" | "commit"> = {
	"dir": "tree",
	"file": "blob",
	"executable": "blob",
}

let templateCache: RestEndpointMethodTypes["gitignore"]["getTemplate"]["response"];

export async function createPullRequest(app: Octokit, owner: string, repo: string,
		{ repoContent, repoInformation }: {
			repoContent?: RestEndpointMethodTypes["repos"]["getContent"]["response"],
			repoInformation?: RestEndpointMethodTypes["repos"]["get"]["response"]
		} = {}
	) {

	// check if there is already a PR to remove node_modules, only uses checking if the title contains "remove node_modules"
	const repoPullsRequest = await app.request("GET /repos/{owner}/{repo}/pulls", {
		owner,
		repo
	})

	const containsRemoveNodeModulesPR = repoPullsRequest.data.some((pullRequest) => pullRequest.title.toLowerCase().includes("remove node_modules"))

	if (containsRemoveNodeModulesPR) {
		return
	}

	const currentUser = await app.users.getAuthenticated()

	const fork = await app.repos.createFork({
		owner,
		repo
	})

	const contentResponse = repoContent ?? await app.repos.getContent({
		owner: currentUser.data.login,
		repo: fork.data.name,
		path: ""
	})

	const content = contentResponse.data

	if (content instanceof Array) {
		const nodeModulesFolder = content.find((file) => file.name === "node_modules")
		if (nodeModulesFolder) {

			const repoInfo = repoInformation ?? await app.repos.get({
				owner,
				repo
			})

			const topCommit = await app.repos.getCommit({
				owner: currentUser.data.login,
				repo: fork.data.name,
				ref: `heads/${repoInfo.data.default_branch}`
			})

			const newBranch = await app.git.createRef({
				owner: currentUser.data.login,
				repo: fork.data.name,
				ref: "refs/heads/remove-node-modules",
				sha: topCommit.data.sha
			})

			const split = newBranch.data.ref.split("/")
			const branchRef = `${split[1]}/${split[2]}`
			const branchName = split[2]

			const newContent = content.map(item => { 
				if (item.name === "node_modules") {
					return undefined
				}
				return { type: TYPE[item.type] , mode: MODE[item.type], path: item.path, sha: item.sha }
			}).filter(value => value !== undefined) as RestEndpointMethodTypes["git"]["createTree"]["parameters"]["tree"]

			const gitignore = newContent.find(file => file.path === ".gitignore")

			let didAddNodeModules = false;

			if (gitignore) {
				const gitignoreBlob = await app.git.getBlob({
					owner: currentUser.data.login,
					repo: fork.data.name,
					file_sha: gitignore.sha!
				})
				const contentBase64 = gitignoreBlob.data.content
				const content = Buffer.from(contentBase64, "base64").toString("ascii")
				if (!content.includes("node_modules")) {
					didAddNodeModules = true
					gitignore.sha = undefined
					gitignore.content = content + "\nnode_modules/"
				}
			} else {
				const template = templateCache ?? await app.gitignore.getTemplate({
					name: "Node"
				})
				templateCache = template
				const newBlob = await app.git.createBlob({
					owner: currentUser.data.login,
					repo: fork.data.name,
					content: template.data.source
				})

				didAddNodeModules = true
				newContent.unshift({ path: ".gitignore", mode: "100644", sha: newBlob.data.sha })
			}

			const commits = await app.request("GET /repos/{owner}/{repo}/commits/{ref}", {
				owner: currentUser.data.login,
				repo: fork.data.name,
				ref: branchRef
			})

			const newTree = await app.git.createTree({
				owner: currentUser.data.login,
				repo: fork.data.name,
				tree: newContent,
			})

			const parents = commits.data.parents.map(commit => commit.sha)
			parents.unshift(topCommit.data.sha)

			const commit = await app.git.createCommit({
				owner: currentUser.data.login,
				repo: fork.data.name,
				parents,
				message: "remove node_modules",
				tree: newTree.data.sha
			})

			await app.git.updateRef({
				owner: currentUser.data.login,
				repo: fork.data.name,
				sha: commit.data.sha,
				ref: branchRef
			})

			// try not to change the title, I don't want duplicates prs, line #24
			await app.pulls.create({
				title: "Remove node_modules",
				owner,
				repo,
				body: `I have detected the existance of node_modules folder in your repo, this PR removes it${didAddNodeModules ? " and adds it to your .gitignore" : ""}`,
				base: repoInfo.data.default_branch,
				head: `${currentUser.data.login}:${branchName}`
			})
			console.log(`Created PR for ${owner}/${repo}`)
		}
	}
}