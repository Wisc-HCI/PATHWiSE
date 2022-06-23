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
    var quickComments = [{
            'group': 'one',
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
            $('#selected-emotion > ul li').removeClass('active');
            $this.addClass('active');
            $this.parents('#selected-emotion').children('p').text($(this).text().trim());
            $this.parents('#selected-emotion').attr('data-toggler', '0');
            $this.parents('#robot-emotions').attr('class', 'blink');
            setTimeout(function() {
                $this.parents('#robot-emotions').attr('class', $this.text().trim().toLowerCase());
            }, 150);
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
                $(document).find('.cp#' + cID).click();
            }
            if ($(elem).hasClass('cn') || $(elem).hasClass('ce')) {
                $('#pages').append('<div data-emotion="' + cEmotion + '" data-comment="' + cText + '" id="c' + commentPinCount + '" class="cp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"><p>' + commentPinCount + '</p></div>');
                $(document).find('.cp#c' + commentPinCount).click();
                commentPinCount++;
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
        $(document).on('click', '.cp', function() {
            $('.cp').removeClass('focused');
            $(this).addClass('focused');
            $(document).find('#selected-emotion > ul li:nth-child(' + $(this).attr('data-emotion').trim() + ')').click();
            $('#comment-input textarea').attr('data-id', $(this).attr('id').trim());
            $('#comment-input textarea').val($(this).attr('data-comment').trim());
            $('#comment-input textarea').focus();
        });
        $(document).on('input', '#comment-input textarea', function() {
            $('.cp#' + $(this).attr('data-id').trim()).attr('data-comment', $(this).val());
        });
        $(document).on('drop', '#comment-input textarea', function(e) {
            e.preventDefault();
        });
    });

    function preInit() {
        var elem = '';
        $.each(emotionsList, function(i, v) {
            $('#selected-emotion>ul').append('<li' + (i == 0 ? ' class="active"' : '') + ' data-id="' + i + '">' + v + '</li>');
        });
        $.each(quickComments, function(i, v) {
            console.log(i, v);
            elem += '<ul data-group="' + v.group + '" data-current="0">';
            $.each(v.comments, function(ci, cv) {
                elem += '<li class="ce" draggable="true" data-emotion="' + getEmotionId(cv.emotion) + '">' + cv.text + '</li>';
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

    function getEmotionId(emotion) {
        var id = 0;
        $.each(emotionsList, function(i, v){
            if (emotion == v) {
                id = i;
            }
        });
        return id;
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