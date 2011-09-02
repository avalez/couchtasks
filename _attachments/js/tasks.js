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

  var mainDb  = document.location.pathname.split('/')[1];
  var paneWidth = 0;
  var router  = Router();
  var current_tpl = null;
  var slidePane = null;
  var docs = {};
  var tasks = [];
  var servers = [];
  var tags = [];
  var currentOffset = 0;
  var lastPane = null;
  var $db = $.couch.db(mainDb);
  var $changes;
  var viewCache = {};
  var current_tags = [];
  var myChanges = [];
  var globalTags = [];
  var currentLimit = 20;


  router.get('#/?', function (_, t) {
    $(window).bind('scroll', infiniteScroll);
    router.forward('#/tags/');
  }).unload(function() {
    $(window).unbind('scroll', infiniteScroll);
  });


  router.get('#/add_server/', function () {
    $db.view('couchtasks/servers').then(function (data) {
      servers = getValues(data.rows);
      render('addserver_tpl', '#add_server', {servers:servers});
    });
  });


  router.get('#/complete/', function (_, id) {
    $db.view('couchtasks/complete', {descending: true}).then(function (data) {
      tasks = getValues(data.rows);
      render('complete_tpl', '#complete_content', {notes:tasks}, initTasksList);
    });
  });


  router.get('#/sync/', function (_, id) {
    $db.view('couchtasks/servers').then(function (data) {
      servers = getValues(data.rows);
      render('sync_tpl', '#sync_content', {servers:servers});
    });
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

        docs[doc._id] = $.extend({}, doc);
        doc.completed = doc.check ? 'checked="checked"' : '';
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
      $('#hdr', dom).bind('click', function(e) {
        if ($(e.target).is("a.tag")) {
          addOrRemove(current_tags, $(e.target).data('key'));
        }
      });
    }).then(function() {
      updateTaskList();
    });

  });


  router.post('#edit', function (_, e, details) {

    var tags = [];
    var doc = docs[details.id];
    var parsedTags = extractTags(details.notes);

    $('.tag_wrapper').find(".tag.active").each(function() {
      tags.push($(this).attr('data-key'));
    });

    doc.tags = tags.concat(parsedTags.tags);
    doc.notes = parsedTags.text;
    doc.check = details.completed && details.completed === 'on';

    $db.saveDoc(doc, {
      success: function () {
        viewCache = {};
        router.back();
      }});
  });


  router.post('#add_server', function (_, e, details) {
    if (details.server === "") {
      $('input[name=server]').addClass('formerror');
      return;
    }
    details.type = 'server';
    $db.saveDoc(details, {
      success: function () {
        viewCache = {};
        router.back();
      }});
  });


  router.post('#add_task', function (_, e, details) {
    var doc = extractTags(details.title);
    newTask(doc.text, '', doc.tags, function (data) {
      viewCache = {};
      $('#add_task_input').val('');
    });
  });


  function infiniteScroll() {
    if  ($(window).scrollTop() == $(document).height() - $(window).height()){
      currentLimit += 20;
      viewCache = {};
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


  function view(name, options) {
    if (typeof viewCache[name] === 'undefined') {
      var success = options.success;
      options.success = function (data) {
        viewCache[name] = data;
        success(data);
      };
      $db.view(name, options);
    } else {
      options.success(viewCache[name]);
    }
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
        viewCache = {};
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
      success: function() {
        viewCache = {};
      }
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

    if (transition === 'slideUp') {

      $('#content').one('webkitTransitionEnd transitionend', function() {
        if (lastPane) {
          lastPane.hide();
        }
        dfd.resolve();
      });

      slidePane = $pane.addClass('slidepane')
        .css({left:currentOffset, top:-$(window).height(), 'z-index': 3})
        .appendTo('#content');
      transformY(slidePane, $(window).height() + 50);

    } else if (slidePane) {

      if (lastPane) {
        lastPane.remove();
        lastPane = null;
      }

      $pane.css({left: currentOffset}).appendTo($('#content'));
      transformY(slidePane, 0);
      lastPane = $pane;

      slidePane.one('webkitTransitionEnd transitionend', function() {
        slidePane.remove();
        slidePane = null;
        dfd.resolve();
      });

    } else {

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
    }
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


  function checkCanSaveNote(e) {
    if ($('input[name=title]').val() === '') {
      $('#createtask_btn').removeClass('active');
    } else {
      $('#createtask_btn').addClass('active');
    }
  }


  function checkCanSaveServer(e) {
    if ($('input[name=server]').val() === '') {
      $('#createserver_btn').removeClass('active');
    } else {
      $('#createserver_btn').addClass('active');
    }
  }


  function calcIndex(a, b) {
    var indexii = {home_tpl:1, complete_tpl:2, sync_tpl:3, task_tpl:4};
    return indexii[a] > indexii[b];
  }


  function findTask(id) {
    for(var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) {
        return tasks[i];
      }
    }
    return false;
  }


  function newTask(title, notes, tags, callback) {

    if(title === '') {
      $('input[name=title]').addClass('formerror');
      return;
    }

    var top = $('#notelist li:not(.date)').first();
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


  function doReplication(obj, callbacks) {
    $.ajax({
      url: "/_replicate",
      type: 'POST',
      data: JSON.stringify(obj),
      contentType : 'application/json',
      dataType : 'json',
      success: callbacks.success,
      error: callbacks.error
    });
  }


  function createUrl(username, password, server, database) {
    if (username === '') {
      return 'http://' + server + '/' + database;
    } else {
      return 'http://' + username + ':' + password + '@' +
        server + '/' + database;
    }
  }


  function viewTask(e) {
    if ($(this).attr("data-noclick")) {
      $(this).removeAttr("data-noclick");
      return;
    }
    if (!$(e.target).is('li.task') && e.target.nodeName !== 'SPAN') {
      return;
    }
    document.location.href = '#/task/' + $(this).attr('data-id') + '/';
  }


  function doSync(e) {

    var li = $(e.target).parents('li').addClass('syncing');
    var server = li.attr('data-server');
    var database = li.attr('data-database');
    var user = li.attr('data-username');
    var pass = li.attr('data-password');

    var error = function() {
      $('#feedback').addClass('error').text('Sync Failed!').show();
      li.removeClass('syncing');
    };

    doReplication({
      create_target: true,
      filter: 'couchtasks/taskfilter',
      target: createUrl(user, pass, server, database),
      source: mainDb
    }, {
      success : function() {
        doReplication({
          filter: 'couchtasks/taskfilter',
          target: mainDb,
          source: createUrl(user, pass, server, database)
        }, { success : function () {
          $('#feedback').addClass('success').text('Sync Complete!').show();
          li.removeClass('syncing');
        }, error: error})
      }, error: error});
  }


  function deleteServer(e) {
    e.preventDefault();
    var li = $(e.target).parents('li');
    $db.removeDoc({_id: li.attr('data-id'), _rev: li.attr('data-rev')}, {
      success: function() {
        viewCache = {};
        li.remove();
      }
    });
  }


  function deleteTask(e) {
    e.preventDefault();
    $(e.target).css({opacity:1});
    var li = $(e.target).parents('li');
    $db.removeDoc({_id: li.attr('data-id'), _rev: li.attr('data-rev')}, {
      success: function() {
        viewCache = {};
        li.fadeOut('medium', function () {
          li.remove();
        });
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
        view('couchtasks/tasks', {
          descending: true,
          limit: currentLimit,
          success : function (data) {
            if (data.total_rows < currentLimit) {
              $(window).unbind('scroll', infiniteScroll);
            }
            tasks = getValues(data.rows);
            renderTasksList(tasks);
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


  function renderTasksList(tasks) {

    tasks.sort(function(a, b) { return a.index < b.index; });

    var date = new Date();
    var today = new Date();
    var todolists = {};
    var completedlists = {};
    var hour = 0;

    $.each(tasks, function(_, obj) {

      var list = obj.check ? completedlists : todolists;
      var thisDate = obj.check ? new Date() : date;
      var prefix  = obj.check ? "z" : "";

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
        hour += obj.time_estimate || 1;
      }
      if (hour >= 8) {
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

    $('#hdr').empty().append(renderedTags.children());
    $('#notelist').empty().append(rendered.children());

    if (!Utils.isMobile()) {
      $('#notelist ul').sortable({
        connectWith: $('#notelist ul'),
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

    var params = $.grep(document.location.hash.replace('#/tags/', '').split(','),
                        function(x) { return x !== ''; });

    $('.checker', dom).bind('change', markDone);
    $('.delete', dom).bind('click', deleteTask);

    $('#edit_filter', dom).bind('mousedown', function() {
      $('#filterui', dom).toggle();
    });

    $('#filterui', dom).bind('mousedown', function(e) {
      if (e.target.nodeName === 'A') {
        addOrRemove(params, $(e.target).data('key'));
      }
    });
  }

  $(window).bind('resize', function () {
    paneWidth = $('body').width();
  }).trigger('resize');


  $('#edittask_btn').bind('click', function (e) {
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

      viewCache = {};

      if (doRefresh && router.matchesCurrent('#/tags/*test')) {
        console.log("Updating");
        updateTaskList();
      }

    });
  }

  setTimeout(startUpdater, 1000);

})();
