var gulp           = require('gulp')
	, path         = require('path')
	, plumber      = require('gulp-plumber')
	, gutil        = require('gulp-util')
	, gulpif       = require('gulp-if')
	, stylus       = require('gulp-stylus')
	, autoprefixer = require('gulp-autoprefixer')
	, errorHandler = require('../utils/errorHandler')
	, paths        = require('../paths')
	, pkg          = require('../../package.json')
	, csso         = require('gulp-csso')
	, debug        = require('gulp-debug');

gulp.task('stylus', function () {
	//console.log('/' + MAIL_NAME + '/common.styl');
	return gulp.src(['common.styl'], {
		cwd: MAIL_NAME + '/app/styles'
	})
		//.pipe(debug())
		.pipe(plumber({
			errorHandler: errorHandler
		}))
		.pipe(stylus({
			'include css': true,
			errors       : true
		}))
		.pipe(autoprefixer(
			'Android >= ' + pkg.browsers.android,
			'Chrome >= ' + pkg.browsers.chrome,
			'Firefox >= ' + pkg.browsers.firefox,
			'Explorer >= ' + pkg.browsers.ie,
			'iOS >= ' + pkg.browsers.ios,
			'Opera >= ' + pkg.browsers.opera,
			'Safari >= ' + pkg.browsers.safari))
		//.pipe(debug())
		.pipe(gulpif(!gutil.env.debug, csso()))
		.pipe(gulp.dest(MAIL_NAME + '/app/assets/styles'));
});

