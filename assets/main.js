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
    $(document).ready(function() {
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
            if ($(elem).hasClass('cn')) {
                cText = '';
            }
            init();
            if ($(elem).hasClass('cp')) {
                var cID = $(elem).attr('id').trim();
                $('.cp#' + cID).css('top', posTop);
                $('.cp#' + cID).css('left', posLeft);
                $('#comment-input textarea').attr('data-id', $(this).attr('id').trim());
            }
            if ($(elem).hasClass('cn') || $(elem).hasClass('ce')) {
                $('#pages').append('<div id="' + commentPinCount + '" class="cp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"><img src="assets/icons/comment-empty.png"><p>' + commentPinCount + '</p></div>');
                $('.cp#' + commentPinCount).attr('data-comment', cText);
                $('#comment-input textarea').val(cText);
                $('#comment-input textarea').focus();
                $('#comment-input textarea').attr('data-id', $(this).attr('id').trim());
                commentPinCount++;
            }
            if ($(elem).hasClass('re')) {
                $('#pages').append('<div id="' + redactPinCount + '" class="rp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"></div>');
                redactPinCount++;
            }
            if ($(elem).hasClass('rp')) {
                var rID = $(elem).attr('id').trim();
                $('.rp#' + rID).css('top', posTop);
                $('.rp#' + rID).css('left', posLeft);
            }
        });
        $(document).on('click', '.cp', function() {
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

    function init() {
        $('.audience-groups li:first-child').click();
        $('.audience-class > ul li:first-child').click();
        $('audiences').attr('data-toggler', '0');
        $('#selected-emotion > ul li:first-child').click();
        $('#selected-emotion').attr('data-toggler', '0');
        $('#comment-input textarea').val('');
    }

    function updateStudents(classID, groupID) {
        $('.audience-students li').removeClass('selected');
        var studentsList = classID + groupID;
        if (studentsList == 'a0' || studentsList == 'b0' || studentsList == 'c0') {
            $('.audience-students li').addClass('selected');
        } else {
            $(eval(studentsList)).each(function(i, v) {
                $('.audience-students li:nth-child(' + v + ')').addClass('selected');
            });
        }
    }
})(window.jQuery);