import {PluginError} from 'gulp-util';
import through from 'through2';
import path from 'path';
import IgnoreFileFilter from './IgnoreFileFilter';

const PLUGIN_NAME = 'vinyl-filter-by-file';
const DEFAULTS = {
	filename: '.ignore',
	maxParent: file => file.base,
	excludeIgnoreFile: true
};

function transformError(callback) {
	return error => callback(new PluginError(PLUGIN_NAME, error));
}

function consistsOf(array, type) {
	for (const element of array) {
		if (typeof element !== type) {
			return false;
		}
	}
	return true;
}

/**
 * @param {Object?} options:
 * name | function | type | default
 * --- | --- | --- | ---
 * filename | name of ignore files | string or array of strings | '.ignore'
 * maxParent | highest folder to traverse up to | path or a function vinylobject => path | file => file.base
 * excludeIgnoreFile | whether to exclude the ignore files | true
 * @returns {function} the stream stage
 */
export default function fileignore(options) {

	const pluginoptions = Object.assign({}, DEFAULTS, options);
	// option variants transformation and type checks
	if (typeof pluginoptions.filename === 'string') {
		pluginoptions.filename = [pluginoptions.filename];
	} else if (!Array.isArray(pluginoptions.filename)) {
		throw new PluginError(PLUGIN_NAME, `options.filename must be a string or a not-empty string array. Got ${typeof pluginoptions.filename}.`);
	} else if (pluginoptions.filename.length === 0) {
		throw new PluginError(PLUGIN_NAME, 'options.filename may not be empty');
	} else if (!consistsOf(pluginoptions.filename, 'string')) {
		throw new PluginError(PLUGIN_NAME, `options.filename may only contain strings. Got ${JSON.stringify(pluginoptions.filename)}.`);
	}
	if (typeof pluginoptions.maxParent === 'string') {
		const parent = path.resolve(process.cwd(), pluginoptions.maxParent);
		pluginoptions.maxParent = () => parent;
	} else if (typeof pluginoptions.maxParent === 'function') {
		const oldMaxParent = pluginoptions.maxParent;
		const cwd = process.cwd();
		pluginoptions.maxParent = vinyl => path.resolve(cwd, oldMaxParent(vinyl));
	} else {
		throw new PluginError(PLUGIN_NAME, `options.maxParent must be a function or a string. Got ${typeof pluginoptions.maxParent}`);
	}
	if (typeof pluginoptions.excludeIgnoreFile !== 'boolean') {
		throw new PluginError(PLUGIN_NAME, `options.excludeIgnoreFile must be a boolean. Got ${typeof pluginoptions.maxParent}`);
	}

	const filter = new IgnoreFileFilter(pluginoptions);

	return through.obj((file, encoding, callback) => {
		// check whether the file is an ignore file and should be excluded
		if (pluginoptions.excludeIgnoreFile && pluginoptions.filename.indexOf(path.basename(file.path)) !== -1) {
			callback(null);
			return;
		}

		filter.check(file.path, pluginoptions.maxParent(file))
			.then(result => result ? callback(null, file) : callback(null))
			.catch(transformError(callback));
	},
	callback => filter.cleanup()
		.then(() => callback(null))
		.catch(transformError(callback)));
}
