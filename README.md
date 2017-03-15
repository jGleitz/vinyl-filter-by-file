# vinyl-filter-by-file

*Filter a [vinyl](https://github.com/gulpjs/vinyl) stream (like [gulp](https://github.com/gulpjs/gulp)’s) based on [`.gitignore`](https://git-scm.com/docs/gitignore)-like files.*

Install this module using npm:

```
npm install --save-dev vinyl-filter-by-file
```

## Usage with gulp

This plugin can be used to filter a stream in gulp:

```js
const gulp = require('gulp');
const ignorefilter = require('vinyl-filter-by-file');

gulp.task('staticassets', () =>
    gulp.src('**', {read: false})
        .pipe(ignorefilter())
        .pipe(gulp.dest('dist'))
);
```

### Options
The plugin exports one function, which returns a `stream.Duplex` that can be `pipe`d into a vinyl `stream.Readable`. The function takes an options object as only parameter. The options are:

 name | description | type | default
 --- | --- | --- | ---
 filename | name of ignore files | string or array of strings | `'.ignore'`
 maxParent | highest folder to traverse up to when looking for ignore files. Paths are resolved against `process.cwd()` | path or a function `vinylobject => path` | `file => file.base`
 excludeIgnoreFile | whether to filter the ignore files from the stream | boolean | `true`

 ### Example with Options

```js
const gulp = require('gulp');
const ignorefilter = require('vinyl-filter-by-file');

gulp.task('staticassets', () =>
    gulp.src('**', {read: false})
        .pipe(ignorefilter({
            filename: '.gitignore',
            excludeIgnoreFile: false,
            maxParent: '.'
        }))
        .pipe(gulp.dest('dist'))
```

If `./.gitignore` looks for example like this:

```
/node_modules/
/dist/
```

the resulting stream will for example include `src/index.js`, `.gitignore`, but not `node_modules/vinyl-filter-by-file/build/index.js`.
