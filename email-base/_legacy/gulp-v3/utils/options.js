var gutil        = require('gulp-util');
var nameConsole  = false;
global.MAIL_NAME = false;

try {
	var category = gutil.env.category,
	    mail     = gutil.env.mail;
	nameConsole  = category + '/mail-' + mail;
} catch (e) {
	nameConsole = 'mail-news'
}
global.MAIL_NAME = category + '/mail-' + gutil.env.mail;

