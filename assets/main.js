(function($) {
    var a1, a2, a3, b1, b2, b3, c1, c2, c3;
    a1 = b2 = c3 = [3, 6, 9, 13, 16, 21, 22, 23, 28, 30];
    a2 = b1 = c2 = [2, 4, 6, 9, 12, 20, 21, 22, 29];
    a3 = b3 = c1 = [3, 6, 9, 22, 23, 28, 30];
    var commentPinCount = 1;
    var redactPinCount = 1;
    var pagesOffsetTop = $('#pages').offset().top;
    var pagesOffsetLeft = $('#pages').offset().left;
    var scrolledDistance = 0;
    var emotionsList = ['Default', 'Happy', 'Questioning', 'Confused', 'Sad', 'Surprised', 'Attentive'];
    var pins = [];
    var quickComments = [{
            'group': 'one',
            'show_items': 1,
            'comments': [{
                    'text': `I'm, confused, can you explain what _______ means?`,
                    'emotion': 'Questioning'
                },
                {
                    'text': `I remember from class. A _______ is like a _____.`,
                    'emotion': 'Default'
                }
            ]
        },
        {
            'group': 'two',
            'show_items': 1,
            'comments': [{
                    'text': `That sounds incredible to me. Do you think _______ is always true?`,
                    'emotion': 'Questioning'
                },
                {
                    'text': `So, in other words, _______.`,
                    'emotion': 'Default'
                }
            ]
        },
        {
            'group': 'three',
            'show_items': 1,
            'comments': [{
                    'text': `That's interesting, I think that _______ will happen next!`,
                    'emotion': 'Attentive'
                },
                {
                    'text': `That is so [shocking] to me.`,
                    'emotion': 'Surprised'
                }
            ]
        }
    ];
    $(document).ready(function() {
        preInit();
        init();
        $(document).on('click', '.comments-list-toggle', function() {
            $('main').attr('data-comments-toggle', '0');
            $('#comments-column-toggler').attr('data-toggler', '0');
        });
        $(document).on('click', '.comments-template-toggle', function() {
            $('main').attr('data-comments-toggle', '1');
            $('#comments-column-toggler').attr('data-toggler', '1');
        });
        $(document).on('click', '#audiences>p', function() {
            if ($(this).parent().attr('data-toggler') == '0') {
                $(this).parent().attr('data-toggler', '1');
            }
        });
        $(document).on('click', '.audience-class li', function() {
            $('.audience-class li').removeClass('selected');
            $(this).addClass('selected');
            var classID = $(this).attr('data-id').trim();
            var groupID = $(this).parents('#audiences').attr('data-group').trim();
            $(this).parents('#audiences').attr('data-class', classID);
            updateStudents(classID, groupID);
        });
        $(document).on('click', '.audience-groups li', function() {
            $('#audiences>p>span').text($(this).text().trim());
            $('.audience-groups li').removeClass('active');
            $(this).addClass('active');
            var classID = $(this).parents('#audiences').attr('data-class').trim();
            var groupID = $(this).attr('data-id').trim();
            $(this).parents('#audiences').attr('data-group', groupID);
            updateStudents(classID, groupID);
        });
        $(document).on('click', '.audience-students li', function() {
            $(this).toggleClass('selected');

        });
        $(document).on('click', function(e) {
            var container = $("#audiences");
            if (!$(e.target).closest(container).length) {
                $('#audiences').attr('data-toggler', '0');
            }
        });
        $(document).on('click', '.add-comment-btn', function() {
            if ($('main').attr('data-comments') == '0') {
                $('main').attr('data-comments', '1');
            } else {
                $('main').attr('data-comments', 0);
            }
        });
        $(document).on('click', '#selected-emotion>p', function() {
            if ($(this).parent().attr('data-toggler') == '0') {
                $(this).parent().attr('data-toggler', '1');
            } else {
                $(this).parent().attr('data-toggler', '0');
            }
        });
        $(document).on('click', '#selected-emotion > ul li', function() {
            var $this = $(this);
            var emotionId = getEmotionId($(this).text().trim());
            $('#selected-emotion > ul li').removeClass('active');
            $this.addClass('active');
            $this.parents('#selected-emotion').children('p').text($(this).text().trim());
            $this.parents('#selected-emotion').attr('data-toggler', '0');
            $this.parents('#robot-emotions').attr('class', 'blink');
            setTimeout(function() {
                $this.parents('#robot-emotions').attr('class', $this.text().trim().toLowerCase());
            }, 150);
            if ($('.cp.focused').length == 1) {
                $('.cp#' + $('.cp.focused').attr('id')).attr('data-emotion', emotionId);
                $('#comments-list [data-id="' + $('.cp.focused').attr('id') + '"]').attr('data-emotion', emotionId);
                managePin($('.cp.focused').attr('id'), 'updateEmotion', emotionId);
            }
        });
        $('#editor').scroll(function() {
            scrolledDistance = parseInt($("#editor").scrollTop());
        });
        $(document).on('dragover', '#pages', function(e) {
            e.preventDefault();
        });
        $(document).on('dragstart', '.cn, .ce, .cp, .re, .rp', function(e) {
            e.originalEvent.dataTransfer.setData("text/html", e.target.outerHTML);
        });
        $(document).on('drop', '#pages', function(e) {
            e.preventDefault();
            var elem = $.parseHTML(e.originalEvent.dataTransfer.getData("text/html"))[0];
            var posTop = (e.originalEvent.clientY - pagesOffsetTop) + scrolledDistance;
            var posLeft = e.originalEvent.clientX - pagesOffsetLeft;
            var cText = $(elem).text().trim();
            var cEmotion = $(elem).attr('data-emotion');
            if ($(elem).hasClass('cn')) {
                cText = '';
            }
            init();
            if ($(elem).hasClass('cp')) {
                var cID = $(elem).attr('id').trim();
                $(document).find('.cp#' + cID).css('top', posTop);
                $(document).find('.cp#' + cID).css('left', posLeft);
                $(document).find('.cp#' + cID + '>p').click();
            }
            if ($(elem).hasClass('cn') || $(elem).hasClass('ce')) {
                $('#pages').append('<div data-emotion="' + cEmotion + '" data-comment="' + cText + '" id="c' + commentPinCount + '" class="cp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"><p>' + commentPinCount + '</p><ul><li class="delete-pin">Delete</li><li class="duplicate-pin">Duplicate</li><li class="new-pin">Create New</li></ul></div>');
                $(document).find('.cp#c' + commentPinCount + '>p').click();
                $('#comments-list>ul').append('<li data-comment="' + cText + '" data-emotion="' + cEmotion + '" data-id="c' + commentPinCount + '"><span class="comment-id">' + commentPinCount + '</span><p>' + cText + '</p></li>');
                var comment = {};
                comment.text = cText;
                comment.emotion = cEmotion;
                comment.id = 'c' + commentPinCount;
                pins.push(comment);
                commentPinCount++;
                if ($(elem).hasClass('cn')) {
                    $('#comment-input textarea').attr('placeholder', '[Create your own comment]');
                }
                if ($(elem).hasClass('ce')) {
                    var groupName = $(elem).attr('data-id').trim().split('-')[0];
                    var currentCommentId = $(elem).attr('data-id').trim().split('-')[1];
                    var latestCommentId = $('#comments-template [data-group="' + groupName + '"]').attr('data-latest').trim();
                    $(document).find('#comments-template [data-id="' + groupName + '-' + currentCommentId + '"]').remove();
                    getNextComment(groupName, latestCommentId);
                }
            }
            if ($(elem).hasClass('re')) {
                $('#pages').append('<div id="r' + redactPinCount + '" class="rp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"></div>');
                redactPinCount++;
            }
            if ($(elem).hasClass('rp')) {
                var rID = $(elem).attr('id').trim();
                $(document).find('.rp#' + rID).css('top', posTop);
                $(document).find('.rp#' + rID).css('left', posLeft);
            }
        });
        $(document).on('drop', '#comment-input textarea', function(e) {
            e.preventDefault();
        });
        $(document).on('click', '.cp>p', function() {
            var $this = $(this).parent();
            $('.cp').removeClass('focused');
            $($this).addClass('focused');
            $(document).find('#selected-emotion > ul li[data-id="' + $($this).attr('data-emotion').trim() + '"]').click();
            $('#comment-input textarea').val($($this).attr('data-comment').trim());
            $('#comment-input textarea').focus();
        });
        $(document).on('click', '#comments-list ul li', function() {
            $(document).find('.cp#' + $(this).attr('data-id') + '>p').click();
            $('#editor').animate({ scrollTop: $('#editor').offset().top + parseInt($('.cp#' + $(this).attr('data-id')).css('top'), 10) - 200 }); // 200 = 116(height from body top to pages/editor top is 116) + 84(scroll to 84px above the pin)
        });
        $(document).on('input', '#comment-input textarea', function() {
            if ($('.cp.focused').length == 1) {
                $('.cp#' + $('.cp.focused').attr('id')).attr('data-comment', $(this).val());
                $('#comments-list [data-id="' + $('.cp.focused').attr('id') + '"]').attr('data-comment', $(this).val());
                $('#comments-list [data-id="' + $('.cp.focused').attr('id') + '"] > p').text($(this).val());
                managePin($('.cp.focused').attr('id'), 'updateComment', $(this).val());
            }
        });
        $(document).on('click', '.delete-pin', function() {
            managePin($(this).parents('.cp').attr('id'), 'delete');
            $('#comments-list li[data-id="' + $(this).parents('.cp').attr('id') + '"]').remove();
            $(this).parents('.cp').remove();
        });
        $(document).on('click', '.duplicate-pin, .new-pin', function() {
            var target = $(document).find('.cp#' + $(this).parents('.cp').attr('id'));
            var posTop = parseInt(target.css('top'), 10);
            var posLeft = parseInt(target.css('left'), 10);
            var cText = target.attr('data-comment');
            var cEmotion = target.attr('data-emotion');
            var editorHeieght = $('#editor').height();
            if ($(this).hasClass('new-pin')) {
                cText = '';
                cEmotion = 0;
            }
            if ((posTop + 50) >= editorHeieght) {
                posTop -= 50;
            } else {
                posTop += 50;
            }
            $('#pages').append('<div data-emotion="' + cEmotion + '" data-comment="' + cText + '" id="c' + commentPinCount + '" class="cp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"><p>' + commentPinCount + '</p><ul><li class="delete-pin">Delete</li><li class="duplicate-pin">Duplicate</li><li class="new-pin">Create New</li></ul></div>');
            $(document).find('.cp#c' + commentPinCount + '>p').click();
            $('#comments-list>ul').append('<li data-comment="' + cText + '" data-emotion="' + cEmotion + '" data-id="c' + commentPinCount + '"><span class="comment-id">' + commentPinCount + '</span><p>' + cText + '</p></li>');
            var comment = {};
            comment.text = cText;
            comment.emotion = cEmotion;
            comment.id = 'c' + commentPinCount;
            pins.push(comment);
            commentPinCount++;
        });
        $(document).on('click', '#save-btn', function() {
            console.log(pins);
        });
    });

    function preInit() {
        var elem = '';
        $.each(emotionsList, function(i, v) {
            $('#selected-emotion>ul').append('<li' + (i == 0 ? ' class="active"' : '') + ' data-id="' + i + '">' + v + '</li>');
        });
        $.each(quickComments, function(i, v) {
            elem += '<ul data-group="' + v.group + '" data-latest="0">';
            var counter = 0;
            $.each(v.comments, function(ci, cv) {
                if (counter < v.show_items) {
                    elem += '<li class="ce" data-id="' + v.group + '-' + ci + '" draggable="true" data-emotion="' + getEmotionId(cv.emotion) + '">' + cv.text + '</li>';
                    counter++;
                } else {
                    return false;
                }
            });
            elem += '</ul>';
        });
        if (quickComments.length > 0 && elem !== '') {
            $('#comments-template').append(elem);
        }
    }

    function init() {
        $('.audience-groups li:first-child').click();
        $('.audience-class > ul li:first-child').click();
        $('#audiences').attr('data-toggler', '0');
        $(document).find('#selected-emotion > ul li:first-child').click();
        $('#selected-emotion').attr('data-toggler', '0');
        $('#comment-input textarea').val('');
    }

    function managePin(id, action, value) {
        $.each(pins, function(i, v) {
            if (v.id == id) {
                if (action == 'updateComment') {
                    v.text = value;
                }
                if (action == 'updateEmotion') {
                    v.emotion = value;
                }
                if (action == 'delete') {
                    pins.splice(i, 1);
                }
                return false;
            }
        });
    }

    function getEmotionId(emotion) {
        var id = 0;
        $.each(emotionsList, function(i, v) {
            if (emotion == v) {
                id = i;
            }
        });
        return id;
    }

    function getNextComment(groupName, latestCommentId) {
        $.each(quickComments, function(i, v) {
            if (v.group.trim() == groupName.trim()) {
                latestCommentId++;
                if (latestCommentId >= v.comments.length) {
                    latestCommentId = 0;
                }
                var cv = v.comments[latestCommentId];
                $('#comments-template [data-group="' + groupName + '"]').append('<li class="ce" data-id="' + v.group + '-' + latestCommentId + '" draggable="true" data-emotion="' + getEmotionId(cv.emotion) + '">' + cv.text + '</li>');
                $('#comments-template [data-group="' + groupName + '"]').attr('data-latest', latestCommentId);
            }
        });
    }

    function updateStudents(classID, groupID) {
        $('.audience-students li').removeClass('selected');
        if (groupID != 4) {
            var studentsList = classID + groupID;
            if (studentsList == 'a0' || studentsList == 'b0' || studentsList == 'c0') {
                $('.audience-students li').addClass('selected');
            } else {
                $(eval(studentsList)).each(function(i, v) {
                    $('.audience-students li:nth-child(' + v + ')').addClass('selected');
                });
            }
        }
    }
})(window.jQuery);