var gulp           = require('gulp')
	, path         = require('path')
	, gulpif       = require('gulp-if')
	, plumber      = require('gulp-plumber')
	, jade         = require('gulp-jade')
	, inheritance  = require('gulp-jade-inheritance')
	, cached       = require('gulp-cached')
	, filter       = require('gulp-filter')
	, rename       = require('gulp-rename')
	, prettify     = require('gulp-html-prettify')
	, pkg          = require('../../package.json')
	, errorHandler = require('../utils/errorHandler')
	, paths        = require('../paths')
	, getData      = require('../utils/getData')
	, inlineCss    = require('gulp-inline-css')
	, wait         = require("gulp-wait")
	, shell        = require("gulp-shell")
	, project      = require('../utils/options').project
	, defContext   = require('../utils/options').getDefaultContext
	, distPath     = path.join('../dist/', MAIL_NAME)
	, tmpPath      = path.join(MAIL_NAME, 'app/tmp')
	, clean        = require("gulp-clean")
	, runSequence  = require('run-sequence')
	, debug        = require('gulp-debug');

gulp.task('jade-inline', ['stylus'], function () {
	console.log("dist", distPath);
	console.log("tmp", tmpPath);
	return gulp.src(path.join(MAIL_NAME, 'app/templates/**/*.jade'))
		.pipe(plumber({
			errorHandler: errorHandler
		}))
		.pipe(gulpif(global.watch, inheritance({
			basedir: 'app/templates'
		})))
		.pipe(filter(function (file) {
			return /index.jade/.test(file.relative);
		}))
		.pipe(jade({
			data: {
				getData: getData,
				page   : {
					copyright  : pkg.copyright,
					description: pkg.description,
					keywords   : pkg.keywords.join(', '),
					title      : pkg.title
				}
			}
		}))
		.pipe(inlineCss({
			applyLinkTags       : true,
			removeLinkTags      : false,
			preserveMediaQueries: true
		}))
		.pipe(gulp.dest(tmpPath))
		.pipe(debug({title: "inline: "}))
		.pipe(shell([
				`inline-css -i index.html -o ../../../${distPath}/index.html`
			],
			{
				cwd: tmpPath
			}))
});

gulp.task("clean-tmp", function () {
	gulp.src(tmpPath, {read: false})
		.pipe(clean({
			force: true
		}))
});

gulp.task("jade", function () {
	runSequence("jade-inline", "clean-tmp");
});