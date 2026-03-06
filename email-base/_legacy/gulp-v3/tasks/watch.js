'use strict';

var gulp          = require('gulp')
	, path        = require('path')
	, watch        = require('gulp-watch')
	, runSequence = require('run-sequence')
	, reload      = require('browser-sync').reload
	, mailWay     = MAIL_NAME + '/';

gulp.task('watchDependencies', [
	'watch',
	'watch:vendorFiles'
]);

gulp.task('watch', function () {
	
	watch(mailWay + 'app/styles/**/*.styl', function () {
		return runSequence('jade','build:localize',['stylus'], reload);
	});
	watch(mailWay + 'lang/**/*.json', function () {
		return runSequence('build:localize', reload);
	});

	watch(mailWay + 'app/resources/**/*', ['copy:resources', reload]);
	watch(mailWay + 'app/templates/**/*.jade', function () {
		return runSequence([
			'jade'],
			'build:localize'
		, reload);
	});
});
gulp.task('watch:vendorFiles', function () {
	watch('../vendor/**/*.jade', [
		'jade',
		'build:localize'
	],reload);
	watch('./vendor/data/**/*.json', function () {
		return runSequence('build:localize', reload);
	});
});
