const getContributors = require("git-contributors").getContributors;

async function firstTimeContributor(pluginConfig, context) {
	const { commits, logger } = context;
	const allContributors = await getContributors(process.cwd());

	const firstTimeContributors = commits.reduce((acc, commit) => {
		const contributor = allContributors.find((c) =>
			c.commits.includes(commit.hash),
		);
		if (contributor && contributor.commits.length === 1) {
			acc.add(contributor.name);
		}
		return acc;
	}, new Set());

	if (firstTimeContributors.size > 0) {
		logger.log(
			"Found first time contributors: %s",
			Array.from(firstTimeContributors).join(", "),
		);
		return `## First Time Contributors

Thank you to our new contributors:
${Array.from(firstTimeContributors)
	.map((name) => `- ${name}`)
	.join("\n")}
`;
	}

	return "";
}

module.exports = {
	generateNotes: firstTimeContributor,
};
