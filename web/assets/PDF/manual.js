var pins = [];
var redactors = [];
var meta = {};
$.each($('#comments-list > ul > li'), function() {
    var comment = {};
    comment.text = $(this).attr('data-comment');
    comment.emotion = $(this).attr('data-emotion');
    comment.top = parseInt($(this).attr('data-top'));
    comment.left = parseInt($(this).attr('data-left'));
    comment.id = $(this).attr('data-id');
    pins.push(comment);
});
$.each($('#editor .rp'), function() {
    var redactor = {};
    redactor.id = $(this).attr('id');
    redactor.top = parseInt($(this).css('top'), 10);
    redactor.left = parseInt($(this).css('left'), 10);
    redactors.push(redactor);
});
meta.pageWidth = $(window).width();
meta.pageHeight = $(window).height();
meta.editorWidth = $('#editor-body').width();
meta.editorHeight = $('#editor-body').height();
meta.title = $('#assignment-title').text().trim();
meta.sampleNo = parseInt($('body').attr('data-version'));
console.log(JSON.stringify(pins), JSON.stringify(redactors), JSON.stringify(meta), JSON.stringify(window.networkLogs));