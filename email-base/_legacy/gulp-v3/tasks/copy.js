var changed, filter, gulp, gulpif, gutil, paths, uglify;

gulp    = require('gulp');
changed = require('gulp-changed');
filter  = require('gulp-filter');
gutil   = require('gulp-util');
paths   = require('../paths');
gulpif  = require('gulp-if');
uglify  = require('gulp-uglify');

gulp.task('copy:images', function () {
	return gulp.src(['**/*.{png,jpg,gif}', '!sprite/**/*'], {
		cwd: paths.appImages
	})
		.pipe(gulp.dest(paths.images));
});

gulp.task('copy:resources', function () {
	return gulp.src('app/resources/**/*')
		.pipe(changed(paths.dist))
		.pipe(gulp.dest(paths.dist));
});

gulp.task('copy', ['copy:images', 'copy:resources']);
