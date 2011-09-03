/*jshint */

window.log = function(){
  log.history = log.history || [];
  log.history.push(arguments);
  if(this.console){
    console.log( Array.prototype.slice.call(arguments) );
  }
};

$.ajaxSetup({
  cache: false
});


var Tasks = (function () {

  var mainDb = document.location.pathname.split('/')[1];
  var paneWidth = 0;
  var router = Router();
  var current_tpl = null;
  var tags = [];
  var currentOffset = 0;
  var lastPane = null;
  var $db = $.couch.db(mainDb);
  var $changes;
  var current_tags = [];
  var myChanges = [];
  var currentLimit = 20;


  router.get('#/?', function (_, t) {
    $(window).bind('scroll', infiniteScroll);
    router.forward('#/tags/');
  }).unload(function() {
    $(window).unbind('scroll', infiniteScroll);
  });


  router.get('#/task/:id/', function (_, id) {
    getTags(function() {

      $db.openDoc(id).then(function(doc) {
        var t = $.map(tags, function(obj) {
          return {
            tag: obj.tag,
            count: obj.count,
            active: !($.inArray(obj.tag, doc.tags) === -1)
          };
        });

        var estimates = [
          {value: 10, text:"10 Minutes"},
          {value: 30, text:"30 Minutes"},
          {value: 60, text:"1 Hour"},
          {value: 120, text:"2 Hours"},
          {value: 240, text:"4 Hours"}
        ];
        for (var x in estimates) {
          if (estimates[x].value === (doc.estimate || 60)) {
            estimates[x].selected = true;
          }
        }

        doc.completed = doc.check ? 'checked="checked"' : '';
        doc.estimates = estimates;
        doc.usedTags = t;
        render('task_tpl', null, doc, function(dom) {
          $('.tag_wrapper', dom).bind('click', function(e) {
            if ($(e.target).is("a.tag")) {
              $(e.target).toggleClass('active');
            }
          });
        });
      });
    });
  });

  router.get('#/tags/*test', function (_, t) {

    current_tags = $.grep(t.split(','), function(x) { return x !== ''; });

    render('home_tpl', '#home_content', {}, function(dom) {
      $('#filter_tags', dom).bind('click', function(e) {
        if ($(e.target).is("a.tag")) {
          addOrRemove(current_tags, $(e.target).data('key'));
        }
      });
    }).then(function() {
      updateTaskList();
    });

  });


  router.post('#edit', function (_, e, details) {

    $db.openDoc(details.id).then(function(doc) {

      var tags = [];
      var parsedTags = extractTags(details.title);

      $('.tag_wrapper').find(".tag.active").each(function() {
        tags.push($(this).attr('data-key'));
      });

      doc.estimate = parseInt(details.estimate, 10);
      doc.tags = tags.concat(parsedTags.tags);
      doc.title = parsedTags.text;
      doc.notes = details.notes;
      doc.check = details.completed && details.completed === 'on';

      $db.saveDoc(doc).then(function() {
        router.back();
      });

    });
  });


  router.post('#add_task', function (_, e, details) {
    var doc = extractTags(details.title);
    newTask(doc.text, '', doc.tags, function (data) {
      $('#add_task_input').val('');
    });
  });


  function infiniteScroll() {
    if  ($(window).scrollTop() == $(document).height() - $(window).height()){
      currentLimit += 20;
      $("#infinite_load").show();
      updateTaskList();
    }
  };


  function addOrRemove(arr, key) {
    if ($.inArray(key, arr) === -1) {
      arr.push(key);
    } else {
      arr = $.grep(arr, function(x) { return x !== key; });
    }
    if (arr.length === 0) {
      document.location.hash = '#/';
    } else {
      document.location.hash = '#/tags/' + arr.join(',');
    }
  }


  function hasTags(doc, tags) {
    var i = 0;
    for(var x in tags) {
      if ($.inArray(tags[x], doc.tags) !== -1) {
        ++i;
      }
    }
    return i === tags.length;
  }


  function exists(arr, id) {
    for(var obj in arr) {
      if (arr[obj]._id === id) {
        return true;
      }
    }
    return false;
  }


  function markDone(e) {

    var status = $(this).is(':checked') ? true : false;
    var li = $(e.target).parents("li");
    var id = li.attr("data-id");
    var url = '/' + mainDb + '/_design/couchtasks/_update/update_status/' + id +
      '?status=' + status;

    myChanges.push(id);

    $.ajax({
      url: url,
      type: 'PUT',
      contentType:'application/json',
      datatype: 'json',
      success: function() {
        if (current_tpl !== 'home_tpl') {
          if (status) {
            li.addClass('deleted');
          } else {
            li.removeClass('deleted');
          }
        } else {
          var ul = li.parent("ul");
          if (status) {
            li.detach();
            li.addClass('deleted');
            li.appendTo(ul);
          } else {
            li.detach();
            li.removeClass('deleted');
            var index = parseInt(li.data("index"), 10);
            var obj;
            ul.children().each(function(_, child) {
              if (parseInt($(child).data("index"), 10) < index) {
                obj = child;
                return false;
              }
            });
            if (!obj) {
              li.appendTo(ul);
            } else {
              li.insertBefore(obj || ul);
            }
          }
        }
      }
    });
  }


  function updateIndex(id, index) {
    var url = '/' + mainDb + '/_design/couchtasks/_update/update_index/' + id +
      '?index=' + index;
    $.ajax({
      url: url,
      type: 'PUT',
      contentType: 'application/json',
      datatype: 'json',
      success: function() {}
    });
  }


  function createIndex(el) {

    var before = el.prev('li.task');
    var after = el.next('li.task');

    if (before.length === 0 && after.length === 0) {
      return false;
    } else if (before.length === 0) {
      return parseInt(after.attr('data-index'), 10) + 1;
    } else if (after.length === 0) {
      return parseInt(before.attr('data-index'), 10) - 1;
    } else {
      return (parseInt(before.attr('data-index'), 10) +
              parseInt(after.attr('data-index'), 10)) / 2;
    }
  }


  function getValues(src) {
    var arr = [], i;
    for (i = 0; i < src.length; i++) {
      arr.push(src[i].value);
    }
    return arr;
  }


  function render(tpl, dom, data, init) {

    var dfd = $.Deferred();
    data = data || {};
    $('body').removeClass(current_tpl).addClass(tpl);

    var rendered = Mustache.to_html($("#" + tpl).html(), data),
    $pane = $('<div class="pane"><div class="content">' + rendered + '</div></div>');
    createCheckBox($pane);

    if (init) {
      init($pane);
    }

    var transition = 'slideHorizontal';

    if (current_tpl) {
      currentOffset += (calcIndex(tpl, current_tpl)) ? paneWidth : -paneWidth;
    }

    var tmp = lastPane;
    $('#content').one('webkitTransitionEnd transitionend', function() {
      if (tmp) {
        tmp.remove();
        tmp = null;
      }
      dfd.resolve();
    });

    transformX($pane, currentOffset);
    $pane.appendTo($('#content'));

    transformX($('#content'), -currentOffset);
    lastPane = $pane;
    current_tpl = tpl;

    return dfd.promise();
  }


  function transformY(dom, x) {
    dom.css('-moz-transform', 'translate(0, ' + x + 'px)')
      .css('-webkit-transform', 'translate(0, ' + x + 'px)');
  }


  function transformX(dom, x) {
    dom.css('-moz-transform', 'translate(' + x + 'px, 0)')
      .css('-webkit-transform', 'translate(' + x + 'px, 0)');
  }


  function calcIndex(a, b) {
    var indexii = {home_tpl:1, complete_tpl:2, sync_tpl:3, task_tpl:4};
    return indexii[a] > indexii[b];
  }


  function newTask(title, notes, tags, callback) {

    if(title === '') {
      $('input[name=title]').addClass('formerror');
      return;
    }

    var top = $('#tasks_wrapper li:not(.date)').first();
    var index = parseInt(top.attr('data-index'), 10) + 1 || 1;

    $db.saveDoc({
      type: 'task',
      index: index,
      check: false,
      title: title,
      tags: tags,
      notes: notes
    }, {
      success: function (data) {
        callback(data);
      }
    });
  }


  function extractTags(text) {
    var tags = $.map(text.match(/\#([\w\-\.]*[\w]+[\w\-\.]*)/g) || [],
                     function(tag) { return tag.slice(1); });

    return {
      tags: tags,
      text: text.replace(/\#([\w\-\.]*[\w]+[\w\-\.]*)/g, '').trim()
    };
  }

  function createCheckBox(parent) {
    $('input[type=checkbox]', parent).each(function() {
      var $input = $(this).wrap('<div class="checkbox"></div>');
      var $wrapper = $(this).parent(".checkbox").append('<div />');
      if ($input.is(':checked')) {
        $wrapper.addClass('checked');
      }
      $wrapper.bind('click', function(){
        $wrapper.toggleClass('checked');
        $input.attr('checked', !$input.is(':checked')).change();
      });
    });
  };


  function updateTaskList() {
    getTags(function() {
      if (!current_tags.length) {
        $db.view('couchtasks/tasks', {
          descending: true,
          limit: currentLimit,
          success : function (data) {
            if (data.total_rows < currentLimit) {
              $(window).unbind('scroll', infiniteScroll);
            }
            tasks = getValues(data.rows);
            renderTasksList(tasks, data.total_rows < currentLimit);
          }
        });
      } else {
        var args = [], tasks = [];
        function designDocs(args) {
          return $db.view('couchtasks/tags', args);
        }
        for (var x in current_tags) {
          args.push({
            reduce:false,
            include_docs: true,
            startkey: [current_tags[x]],
            endkey: [current_tags[x]]
          });
        }
        $.when.apply(this, $.map(args, designDocs)).then(function () {
          if (args.length === 1) {
            arguments = [arguments];
          }
          $.each(arguments, function(element, i) {
            $.each(i[0].rows, function(y) {
              if (hasTags(i[0].rows[y].doc, current_tags) &&
                  !exists(tasks, i[0].rows[y].id)) {
                tasks.push(i[0].rows[y].doc);
              }
            });
          });
          renderTasksList(tasks);
        });
      }
    });
  }


  function formatDate(date) {
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                'Friday', 'Saturday'];
    var months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November',
                  'December'];
    var day = date.getDate();
    var prefix = (day === 1) ? 'st' :
      (day === 2) ? 'nd' :
      (day === 3) ? 'rd' : 'th';
    return days[date.getDay()] +
      " " + date.getDate() + prefix + " of " + months[date.getMonth()];
  }


  function renderTasksList(tasks, end) {

    tasks.sort(function(a, b) { return b.index - a.index; });

    var date = new Date();
    var today = new Date();
    var todolists = {};
    var completedlists = {};
    var hour = 0;

    $.each(tasks, function(_, obj) {

      var list = obj.check ? completedlists : todolists;
      var thisDate = obj.check ? new Date() : date;
      var prefix  = obj.check ? "z" : "";

      obj.estimate = obj.estimate || 60;

      if (obj.check && obj.check_at) {
        thisDate = new Date(obj.check_at);
      }

      if (typeof list[prefix + thisDate.toDateString()] === 'undefined') {
        list[prefix + thisDate.toDateString()] = {
          jsonDate: thisDate,
          date:formatDate(thisDate),
          notes: [],
          completed: prefix === 'z'
        };
      }
      list[prefix + thisDate.toDateString()].notes.push(obj);
      if (!obj.check) {
        hour += obj.estimate;
      }
      if (hour >= (8 * 60)) {
        hour = 0;
        date.setDate(date.getDate() - 1);
      }
    });

    var obj = {tasklist: []};

    for (var x in todolists) {
      obj.tasklist.push(todolists[x]);
    }
    for (var x in completedlists) {
      obj.tasklist.push(completedlists[x]);
    }


    var rendered =
      $('<div>' + Mustache.to_html($('#rows_tpl').html(), obj) + '</div>');
    createCheckBox(rendered);
    initTasksList(rendered);

    var usedTags = $.map(tags, function(obj) {
        return {
          tag: obj.tag,
          count: obj.count,
          active: !($.inArray(obj.tag, current_tags) === -1)
        };
    });

    var renderedTags =
      $('<div>' + Mustache.to_html($('#tags_tpl').html(), {tags: usedTags}) +
        '</div>');

    $('#filter_tags').empty().append(renderedTags.children());
    $('#tasks_wrapper').empty().append(rendered.children());

    $("#infinite_load").hide();
    if (end) {
      $('#tasks_end').show();
    }

    if (!Utils.isMobile()) {
      $('#tasks_wrapper ul').sortable({
        connectWith: $('#tasks_wrapper ul'),
        items: 'li:not(.date)',
        axis:'y',
        distance:30,
        start: function(event, ui) {
          ui.item.attr('data-noclick','true');
        },
        stop: function(event, ui) {
          var index = createIndex(ui.item);
          if (index !== false) {
            updateIndex(ui.item.attr('data-id'), index);
          }
        }
      });
    }
  }


  function initTasksList(dom) {
    $('.checker', dom).bind('change', markDone);
  }

  $(window).bind('resize', function () {
    paneWidth = $('body').width();
  }).trigger('resize');


  $('#save_task_btn').bind('click', function (e) {
    $('#edit_task_form').trigger('submit');
  });


  function getTags(callback) {
    $db.view('couchtasks/tags', {
      group: true,
      success: function(data) {

        var colors = ['#288BC2', '#DB2927', '#17B546', '#EB563E', '#AF546A',
                      '#4A4298', '#E7CD17', '#651890', '#E1B931', '#978780',
                      '#CC7E5B', '#7C3F09', '#978780', '#07082F'];

        var x, tag, i = 0, css = [];

        tags = [];
        for (x in data.rows) {
          tag = data.rows[x].key[0]
          css.push('.tag_' + tag + ' { background: ' + colors[i++] + ' }');
          tags.push({tag: tag, count: data.rows[x].value});
        }

        $("#tag_defs").html(css.join('\n'));

        callback();
      }
    });
  };

  router.init(window);

  function startUpdater() {

    $changes = $db.changes();
    $changes.onChange(function(changes) {

      var doRefresh = false;
      // Full refresh if design doc changes
      for(var i in changes.results) {
        if (/^_design/.test(changes.results[i].id)) {
          document.location.reload();
        }
        if (!doRefresh && $.inArray(changes.results[i].id, myChanges) === -1) {
          doRefresh = true;
        }
      }

      if (doRefresh && router.matchesCurrent('#/tags/*test')) {
        console.log("Updating");
        updateTaskList();
      }

    });
  }

  setTimeout(startUpdater, 1000);

})();
