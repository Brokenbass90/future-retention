'use strict';

var gulp       = require('gulp')
	, filter   = require('gulp-filter')
	, i18n     = require('gulp-html-i18n')
	, paths    = require('../paths')
	, prettify = require('gulp-html-prettify')
	, debug    = require('gulp-debug');

gulp.task('build:localize', ['jade'], function () {
	return gulp.src([
		'dist/' + MAIL_NAME + '/*.html',
		'!dist/' + MAIL_NAME + '/??/*.html'
	])
		//.pipe(debug())
		.pipe(i18n({
			langDir       : './vendor/data',
			createLangDirs: 'true',
			trace         : true,
			failOnMissing : false
		}))
		//.pipe(debug())
		.pipe(prettify({
			brace_style      : 'expand',
			indent_size      : 1,
			indent_char      : '\t',
			indent_inner_html: true,
			preserve_newlines: true
		}))
		.pipe(gulp.dest('dist/' + MAIL_NAME))
});
