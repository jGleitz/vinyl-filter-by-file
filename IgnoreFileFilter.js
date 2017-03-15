import path from 'path';
import ignore from 'ignore';
import nodeFs from 'fs';

const fs = {
	readFile: (file, options) => new Promise((resolve, reject) =>
		nodeFs.readFile(file, options, (error, data) => {
			if (error) reject(error);
			else resolve(data);
		}))
};

const NEVER = () => false;
const ALWAYS = () => true;

/**
 * Takes an error and returns null, if its a “no such file” error. Throws the error otherwise.
 *
 * @param {Error} error
 *		The error to check.
 * @returns {null} null if the error’s code is 'ENOENT'.
 * @throws the error if its code isn’t 'ENOENT'.
 */
function nullIfNonExistant(error) {
	if (error.code === 'ENOENT') {
		return null;
	}
	throw error;
}

/**
 * A filter that can be used to check whether files should be included based on gitignore-like files in the directory tree.
 */
export default class IgnoreFileFilter {

	/**
	 * Creates a new filter out of the provided options.
	 *
	 * @param {Object} options An option object, having the following members:
	 * name | type | description
	 * --- | --- | ---
	 * filenames | array of strings | filenames of ignore files to consider
	 */
	constructor(options) {
		this.cache = {};
		this.filenames = options.filename;
	}

	/**
	 * Checks whether the provided path should be included.
	 *
	 * @param {string} filePath
	 *		The path to check.
	 * @param {string} maxParent
	 *		Path to the maximum parent. Only ignore files in or below this folder will be considered.
	 * @returns {Promise} A promise for a boolean indicating whether the file should be included (true) or excluded (false).
	 */
	check(filePath, maxParent) {
		return this.checkerFor(path.dirname(filePath), maxParent)
			.then(checker => checker(filePath));
	}

	/**
	 * Creates a checker function that can be used to check (probably deeply nested) files in the provided folder for inclusion. The checker considers all ignore files in the provided folder and above it (up to maxParent), but none below it.
	 *
	 * @param {string} folder
	 *		Path to the folder to create the checker for.
	 * @param {string} maxParent
	 *		Path to the maximum parent. Only ignore files in or below this folder will be considered by the created checker.
	 * @returns {Promise} A promise for the checker function described above.
	 */
	checkerFor(folder, maxParent) {
		if (this.cache[folder]) {
			return Promise.resolve(this.cache[folder]);
		} else {
			if (!folder.startsWith(maxParent)) {
				return Promise.reject(new Error(`${folder} is outside of maxParent (${maxParent}).`));
			}
			let chain;
			if (folder === maxParent) {
				// no parent folder, result depends only on the file in this folder
				chain = this.checkerFromFilesIn(folder);
			} else {
				// if this folder’s parent excludes this folder, we can inconditionally exclude all files in this folder
				chain = this.checkerFor(path.dirname(folder), maxParent)
					.then(parentChecker => {
						if (!parentChecker(folder)) {
							return NEVER;
						}
						return this.checkerFromFilesIn(folder)
							.then(folderChecker => file => folderChecker(file) && parentChecker(file));
					});
			}
			return chain.then(checker => this.cache[folder] = checker);
		}
	}

	/**
	 * Creates a checker function that can be used to check (probably deeply nested) files in the provided folder for inclusion. The checker only considers ignore files in the provided folder.
	 *
	 * @param {string} folder
	 *		Path to the folder to read the ignore files from.
	 * @returns {Promise} A promise for the checker function described above.
	 */
	checkerFromFilesIn(folder) {
		// read all possible ignore files. If one does not exist, simply return null for its contents
		return Promise.all(
			this.filenames.map(filename => fs.readFile(path.join(folder, filename)).catch(nullIfNonExistant))
		)
			.then(contents => {
				let ignores = null;
				for (const lines of contents) {
					if (lines !== null) {
						if (ignores === null) ignores = ignore();
						ignores.add(lines.toString());
					}
				}
				if (ignores === null) {
					// there was not a single ignore file. We can inconditionally include all files in this folder.
					return ALWAYS;
				}
				// there was at least one ignore file. Create a filter out of it and use it.
				const ignoreFilter = ignores.createFilter();
				return file => ignoreFilter(path.relative(folder, file));
			});
	}

	/**
	 * Frees cached data.
	 *
	 * @returns {Promise} A promise for the cleanup’s success.
	 */
	cleanup() {
		this.cache = null;
		return Promise.resolve();
	}
}
