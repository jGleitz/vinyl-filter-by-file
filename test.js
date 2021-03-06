/* eslint-env mocha */
/* eslint no-undefined: "off" */

import ignorefile from './index.js';

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import es from 'event-stream';
import gulp from 'gulp';
import path from 'path';
import promisify from 'promisify-node';
import mkdirp from 'mkdirp-promise';
import {PluginError} from 'gulp-util';

chai.use(chaiAsPromised);
chai.should();

const tmp = promisify('tmp');
const fs = promisify('fs');

let TMP;
let casecounter = 0;

const PLUGIN_NAME = 'vinyl-filter-by-file';

// custom assertion for errors thrown by the plugin
chai.Assertion.addMethod('throwPluginError', function() {
	new chai.Assertion(this._obj).to.throw(PluginError).with.property('plugin', PLUGIN_NAME);
});

/**
 * Gets the paths of a vinyl stream.
 *
 * @param {Stream} stream
 * 		A stream of vinyls.
 * @return {Promise<string[]>} A promise for all paths of the vinyls contained in the `stream`, resolved to be relative to their vinyl’s `base`.
 */
function readStreamPaths(stream) {
	return new Promise((resolve, reject) => {
		stream.on('error', reject);
		return stream.pipe(es.writeArray((error, array) => error ? reject(error) : resolve(array)));
	})
		.then(vinylarray => vinylarray.map(vinyl => path.relative(vinyl.base, vinyl.path)));
}

/**
 * Creates a function that writes an ignore file. The functions expects a base path in which the file can be created and also returns that path for further usage.
 *
 * @param {string} filePath
 *		Path to where the file should be created. Relative to the base path that will be provided to the returned function. All folders on the path will be created.
 * @param {string[]} contents
 *		The contents of the file to be written. One array elements corresponds to one output line.
 * @return {function} The function that takes a base path, creates the ignore file in it and returns the base path.
 */
function writeIgnoreFile(filePath, contents) {
	return prefix => {
		const fullPath = path.join(prefix, filePath);
		return mkdirp(path.dirname(fullPath))
			.then(() => fs.writeFile(fullPath, contents.join('\n')))
			.then(() => prefix);
	};
}

/**
 * Creates the provided filenames in a new temporary folder.
 *
 * @param {string[]} filenames
 *		Names of the files that should be created. The paths may include directories that will automatically be created.
 * @return {Promise<string>} A promise that will be resolved with the path to the folder in which the files were created after all have been created.
 */
function touch(filenames) {
	const caseid = `case${casecounter++}`;
	const prefix = path.join(TMP, caseid);
	return Promise.all(
		filenames
			.map(filePath => path.join(prefix, filePath))
			.map(file => mkdirp(path.dirname(file))
				.then(() => fs.writeFile(file, ''))
			)
	)
		.then(() => prefix);
}

/**
 * Creates a promise that will be resolved when the provided `stream` is finished.
 *
 * @param {Stream} stream
 * 		A stream.
 * @return {Promise} A promise that will be resolved when the `stream` finished and rejected if an error is emitted on the `stream`.
 */
function streamPromise(stream) {
	return new Promise((resolve, reject) => {
		stream.on('finish', resolve);
		stream.on('error', reject);
	});
}

describe('vinyl-filter-by-file', () => {
	before('get temporary folder', () => {
		tmp.setGracefulCleanup();
		return tmp.dir({unsafeCleanup: true})
			.then(dir => TMP = dir);
	});

	it('can be called without parameters', () => {
		ignorefile.should.not.throw();
	});

	it('does not modify the stream if no ignore files exist', () => {
		const samplefiles = ['a', 'b/a', 'b/b', 'b/c', 'b/d/a/a/a', 'b/d/a/b', 'b/e'];
		return touch(samplefiles)
			.then(prefix => readStreamPaths(
				gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true})
					.pipe(ignorefile())
			))
			.should.eventually.have.members(samplefiles);
	});

	it('excludes files based on ignore files in the same folder', () =>
		touch(['a', 'b/a', 'b/b/a', 'b/b/b', 'b/c/a', 'b/c/b', 'b/d', 'c', 'd/a', 'd/b', 'd/c'])
			.then(writeIgnoreFile('.ignore', ['/c', '/d']))
			.then(writeIgnoreFile('b/.ignore', ['/b', '/d']))
			.then(prefix => readStreamPaths(
				gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true})
					.pipe(ignorefile())
			))
			.should.eventually.have.members(['a', 'b/a', 'b/c/a', 'b/c/b'])
	);

	it('considers ignore files from folders above', () =>
		touch(['a', 'b/a', 'b/b/a', 'b/b/b', 'b/c/a', 'b/c/b', 'b/d/x', 'b/d/y', '/b/e/a', 'b/e/b', 'b/e/c', 'b/e/d', 'c/a', 'c/b', 'd/a', 'd/b/b', 'd/b/c', 'd/b/d', 'd/c'])
			.then(writeIgnoreFile('.ignore', ['a', '**/b/d', '/d/b/c', '/c']))
			.then(writeIgnoreFile('c/.ignore', ['a']))
			.then(writeIgnoreFile('b/.ignore', ['/e/b']))
			.then(writeIgnoreFile('b/e/.ignore', ['d']))
			.then(prefix => readStreamPaths(
				gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true})
					.pipe(ignorefile())
			))
			.should.eventually.have.members(['b/b/b', 'b/c/b', 'b/e/c', 'd/b/b', 'd/c'])
	);

	it('emits errors to the stream', () =>
		touch(['a/.ignore/b'])
			.then(prefix => streamPromise(
				gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true, dot: true})
					.pipe(ignorefile())
			))
			.should.be.rejectedWith('EISDIR')
	);

	describe('filename option', () => {
		it('accepts strings and string arrays', () => {
			(() => ignorefile({
				filename: 'foo'
			})).should.not.throw();

			(() => ignorefile({
				filename: ['foo']
			})).should.not.throw();

			(() => ignorefile({
				filename: ['foo', 'bar']
			})).should.not.throw();
		});

		it('does not accept other types', () => {
			(() => ignorefile({
				filename: {}
			})).should.throwPluginError();

			(() => ignorefile({
				filename: []
			})).should.throwPluginError();

			(() => ignorefile({
				filename: ['foo', 3, 'bar']
			})).should.throwPluginError();

			(() => ignorefile({
				filename: ['foo', undefined, 'bar']
			})).should.throwPluginError();

			(() => ignorefile({
				filename: null
			})).should.throwPluginError();
		});

		it('considers multiple file names and possibly joins them', () =>
			touch(['a', 'b/a', 'b/b/a', 'b/b/b', 'b/c/a', 'b/c/b', 'b/d/x', 'b/d/y', '/b/e/a', 'b/e/b', 'b/e/c', 'b/e/d', 'c/a', 'c/b', 'd/a', 'd/b/b', 'd/b/c', 'd/b/d', 'd/c'])
				.then(writeIgnoreFile('.ignoreA', ['a', '**/b/d', '/d/b/c']))
				.then(writeIgnoreFile('.ignoreB', ['/d/b/c', '/c']))
				.then(writeIgnoreFile('.ignore', ['b']))
				.then(writeIgnoreFile('c/.ignoreA', ['a']))
				.then(writeIgnoreFile('b/.ignoreB', ['/e/b']))
				.then(writeIgnoreFile('b/e/.ignoreA', ['d']))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true})
						.pipe(ignorefile({
							filename: ['.ignoreA', '.ignoreB']
						}))
				))
				.should.eventually.eventually.have.members(['b/b/b', 'b/c/b', 'b/e/c', 'd/b/b', 'd/c'])
		);
	});

	describe('excludeIgnoreFile option', () => {
		it('only accepts boolean values', () => {
			(() => ignorefile({
				excludeIgnoreFile: null
			})).should.throwPluginError();

			(() => ignorefile({
				excludeIgnoreFile: {}
			})).should.throwPluginError();

			(() => ignorefile({
				excludeIgnoreFile: 'true'
			})).should.throwPluginError();

			(() => ignorefile({
				excludeIgnoreFile: 2
			})).should.throwPluginError();

			(() => ignorefile({
				excludeIgnoreFile: []
			})).should.throwPluginError();
		});

		it('excludes ignore files by default', () =>
			touch(['a', 'b/a', 'b/b/a', 'b/b/b', 'b/c/a', 'b/c/b', 'b/d', 'c', 'd/a', 'd/b', 'd/c'])
				.then(writeIgnoreFile('.ignore', ['/c', '/d']))
				.then(writeIgnoreFile('b/.ignore', ['/b', '/d']))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true, dot: true})
						.pipe(ignorefile())
				))
				.should.eventually.have.members(['a', 'b/a', 'b/c/a', 'b/c/b'])
		);

		it('excludes ignore files if requested', () =>
			touch(['a', 'b/a', 'b/b/a', 'b/b/b', 'b/c/a', 'b/c/b', 'b/d', 'c', 'd/a', 'd/b', 'd/c'])
				.then(writeIgnoreFile('.ignore', ['/c', '/d']))
				.then(writeIgnoreFile('b/.ignore', ['/b', '/d']))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true, dot: true})
						.pipe(ignorefile({
							excludeIgnoreFile: true
						}))
				))
				.should.eventually.have.members(['a', 'b/a', 'b/c/a', 'b/c/b'])
		);

		it('includes ignore files if requested', () =>
			touch(['a', 'b/a', 'b/b/a', 'b/b/b', 'b/c/a', 'b/c/b', 'b/d', 'c', 'd/a', 'd/b', 'd/c'])
				.then(writeIgnoreFile('.ignore', ['/c', '/d']))
				.then(writeIgnoreFile('b/.ignore', ['/b', '/d']))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true, dot: true})
						.pipe(ignorefile({
							excludeIgnoreFile: false
						}))
				))
				.should.eventually.have.members(['a', 'b/a', 'b/c/a', 'b/c/b', '.ignore', 'b/.ignore'])
		);
	});

	describe('maxParent option', () => {
		it('accepts strings and functions', () => {
			(() => ignorefile({
				maxParent: '/'
			})).should.not.throw();

			(() => ignorefile({
				maxParent: () => '/'
			})).should.not.throw();

			(() => ignorefile({
				maxParent: file => file.base
			})).should.not.throw();
		});

		it('does not accept other types', () => {
			(() => ignorefile({
				maxParent: {}
			})).should.throwPluginError();

			(() => ignorefile({
				maxParent: []
			})).should.throwPluginError();

			(() => ignorefile({
				maxParent: ['foo', 3, 'bar']
			})).should.throwPluginError();

			(() => ignorefile({
				maxParent: ['foo', null, 'bar']
			})).should.throwPluginError();

			(() => ignorefile({
				maxParent: null
			})).should.throwPluginError();
		});

		it('defaults to file.base', () =>
			touch(['a/a/a', 'a/a/b', 'a/a/c/a', 'a/a/c/b', 'a/a/d'])
				.then(writeIgnoreFile('.ignore', ['a/a/a', 'a/a/c']))
				.then(writeIgnoreFile('a/.ignore', ['a/b']))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: path.join(prefix, 'a'), read: false, nodir: true})
						.pipe(ignorefile())
				))
				.should.eventually.have.members(['a/a', 'a/c/a', 'a/c/b', 'a/d'])
		);

		it('can be set to a path', () =>
			touch(['a/a/a', 'a/a/b', 'a/a/c/a', 'a/a/c/b', 'a/a/d'])
				.then(writeIgnoreFile('.ignore', ['a/a/a', 'a/a/c']))
				.then(writeIgnoreFile('a/.ignore', ['a/b']))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: path.join(prefix, 'a'), read: false, nodir: true})
						.pipe(ignorefile({
							maxParent: prefix
						}))
				))
				.should.eventually.have.members(['a/d'])
		);

		it('can be set to a function', () =>
			touch(['a/a/a', 'a/a/b', 'a/a/c/a', 'a/a/c/b', 'a/a/d'])
				.then(writeIgnoreFile('.ignore', ['a/a/a', 'a/a/c']))
				.then(writeIgnoreFile('a/.ignore', ['a/b']))
				.then(writeIgnoreFile('a/a/c/.ignore', ['b']))
				.then(writeIgnoreFile('a/a/.ignore', ['c']))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true})
						.pipe(ignorefile({
							maxParent: file => path.dirname(file.path)
						}))
				))
				.should.eventually.have.members(['a/a/a', 'a/a/b', 'a/a/c/a', 'a/a/d'])
		);

		it('emits errors for bad maxParents to the stream', () =>
			touch(['a/a'])
				.then(prefix => streamPromise(
					gulp.src(`${prefix}/**`, {base: prefix, read: false, nodir: true})
						.pipe(ignorefile({
							maxParent: path.join(prefix, 'a/b')
						}))
				))
				.should.be.rejected
		);

		it('resolves constant paths against process.cwd', () =>
			touch(['a/a/a', 'a/a/b', 'a/a/c/a', 'a/a/c/b', 'a/a/d'])
				.then(writeIgnoreFile('.ignore', ['a/a/a', 'a/a/c']))
				.then(writeIgnoreFile('a/.ignore', ['a/b']))
				.then(prefix => (process.chdir(prefix), prefix))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: path.join(prefix, 'a'), read: false, nodir: true})
						.pipe(ignorefile({
							maxParent: '.'
						}))
				))
				.should.eventually.have.members(['a/d'])
		);

		it('resolves function results against process.cwd', () =>
			touch(['a/a/a', 'a/a/b', 'a/a/c/a', 'a/a/c/b', 'a/a/d'])
				.then(writeIgnoreFile('.ignore', ['a/a/a', 'a/a/c']))
				.then(writeIgnoreFile('a/.ignore', ['a/b']))
				.then(prefix => (process.chdir(prefix), prefix))
				.then(prefix => readStreamPaths(
					gulp.src(`${prefix}/**`, {base: path.join(prefix, 'a'), read: false, nodir: true})
						.pipe(ignorefile({
							maxParent: () => '.'
						}))
				))
				.should.eventually.have.members(['a/d'])
		);
	});
});
