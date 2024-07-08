const targetVersion = process.env.npm_package_version;
if (!targetVersion) process.exit(1);

async function updateManifest(filePath: string, version: string) {
	const manifest = JSON.parse(await Bun.file(filePath).text());
	const minAppVersion = manifest.minAppVersion;
	manifest.version = version;
	await Bun.write(filePath, JSON.stringify(manifest, null, "\t"));
	return minAppVersion;
}

async function updateVersions(
	filePath: string,
	version: string,
	minAppVersion: string,
) {
	const versions = JSON.parse(await Bun.file(filePath).text());
	versions[version] = minAppVersion;
	await Bun.write(filePath, JSON.stringify(versions, null, "\t"));
}

const minAppVersionBeta = await updateManifest(
	"manifest-beta.json",
	targetVersion,
);

if (!targetVersion.includes("-")) {
	const minAppVersion = await updateManifest("manifest.json", targetVersion);
	await updateVersions("versions.json", targetVersion, minAppVersion);
} else {
	await updateVersions("versions.json", targetVersion, minAppVersionBeta);
}

export type {};
