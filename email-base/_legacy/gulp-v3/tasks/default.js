'use strict';

var gulp        = require('gulp');
var runSequence = require('run-sequence');
var gutil       = require('gulp-util');

gulp.task('default', function () {
	return runSequence([
			'stylus',
			'jade',
			'build:localize'
		],
		'browserSync',
		'watchDependencies')
});

gulp.task('build', ['del'], function () {
	return runSequence([
		'stylus',
		'jade',
		'copy',
		'build:localize'
	]);
});

gulp.task('deploy', function () {
	return runSequence(
		'del', 'build'
	);

});
