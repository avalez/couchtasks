

window.log = function() {
  log.history = log.history || [];
  log.history.push(arguments);
  if(this.console){
    console.log( Array.prototype.slice.call(arguments) );
  }
};


$.ajaxSetup({
  cache: false
});


// Basic wrapper for localStorage
var localJSON = (function(){
  if (!localStorage) {
    return false;
  }
  return {
    set: function(prop, val) {
      localStorage.setItem(prop, JSON.stringify(val));
    },
    get: function(prop, def) {
      return JSON.parse(localStorage.getItem(prop) || 'false') || def;
    },
    remove: function(prop) {
      localStorage.removeItem(prop);
    }
  };
})();


var Tasks = (function () {

  // This is the list of predefined tag colours, if there are more tags
  // than colours then tags turn black
  var tagColors = [
    '#288BC2', '#DB2927', '#17B546', '#EB563E', '#AF546A', '#4A4298',
    '#E7CD17', '#651890', '#E1B931', '#978780', '#CC7E5B', '#7C3F09',
    '#978780', '#07082F'
  ];

  var taskEstimates = [
    {value: 10, text: '10 Minutes'},
    {value: 30, text: '30 Minutes'},
    {value: 60, text: '1 Hour'},
    {value: 120, text: '2 Hours'},
    {value: 240, text: '4 Hours'}
  ];

  var days = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  var months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  var dbName = document.location.pathname.split('/')[1];
  var $db = $.couch.db(dbName);
  var $changes;

  var router = Router();

  var paneWidth = 0;
  var currentOffset = 0;
  var lastPane = null;

  var myChanges = [];
  var current_tpl = null;
  var currentLimit = 20;


  router.get('#/?', function (_, t) {
    router.forward('#/tags/');
  });


  router.get('#/task/:id/', function (_, id) {

    $.when(getTags(), $db.openDoc(id)).then(function(tags, doc) {

      doc = doc[0];
      doc.estimate = doc.estimate || 60;

      doc.tags = $.each(tags, function(_, obj) {
        obj.active = !($.inArray(obj.tag, doc.tags) === -1);
      });

      doc.estimates = $.each($.extend(true, [], taskEstimates), function(_, obj) {
        if (obj.value === doc.estimate) {
          obj.selected = true;
        }
      });

      render('task_tpl', null, doc, function(dom) {
        $('a.tag', dom[0]).live('click', function(e) {
          $(e.target).toggleClass('active');
        });
      });
    });

  });


  router.get('#/tags/*test', function (_, t) {
    var opts = {
      showFilters: localJSON.get('showFilters', false)
    };
    render('home_tpl', '#home_content', opts, function(dom) {
      $('a.tag', dom[0]).live('click', function(e) {
        updateFilterUrl($(e.target).data('key'));
      });
    }).then(updateTaskList);
  });

  router.post('#edit', function (_, e, details) {

    $db.openDoc(details.id).then(function (doc) {

      var tags = [];
      var parsedTags = extractHashTags(details.title);

      $('.tag_wrapper .tag.active').each(function () {
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

    var doc = extractHashTags(details.title);
    var top = $('#tasks_wrapper li:not(.date)').first();
    var index = top.data('index') + 1 || 1;

    if(doc.text === '') {
      return;
    }

    $db.saveDoc({
      type: 'task',
      index: index,
      check: false,
      title: doc.text,
      tags: doc.tags
    }).then(function (data) {
      $('#add_task_input').val('');
    });

  });


  router.post('#delete_task', function (_, e, details) {
    $db.removeDoc({_id: details.id, _rev: details.rev}).then(function() {
      router.back();
    });
  });


  function markDone(e) {

    var status = $(this).is(':checked');
    var li = $(e.target).parents("li");
    var id = li.attr("data-id");

    myChanges.push(id);

    $db.updateDoc("couchtasks/update_status", id, {status:status}).then(function() {
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
          var index = li.data("index");
          var obj;
          ul.children().each(function(_, child) {
            if ($(child).data("index") < index) {
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
    });
  }


  function updateIndex(id, index) {
    $db.updateDoc("couchtasks/update_index", id, {index:index});
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


  function calcIndex(a, b) {
    var indexii = {home_tpl:1, complete_tpl:2, sync_tpl:3, task_tpl:4};
    return indexii[a] > indexii[b];
  }


  function updateTaskList() {

    getTags().then(function (tags) {

      if (!tagsFromUrl().length) {

        $db.view('couchtasks/tasks', {
          descending: true,
          include_docs: true,
          limit: currentLimit
        }).then(function (data) {
          tasks = $.map(data.rows, function(obj) { return obj.doc; });
          renderTasksList(tasks, tags, true, data.total_rows < currentLimit);
        });

      } else {

        var designDocs = function(args) {
          return $db.view('couchtasks/tags', args);
        }

        var args = $.map(tagsFromUrl(), function(tag) {
          return {
            reduce:false,
            include_docs: true,
            startkey: [tag],
            endkey: [tag]
          };
        });

        $.when.apply(this, $.map(args, designDocs)).then(function () {

          // Stupid jquery deferred bug
          if (args.length === 1) {
            arguments = [arguments];
          }

          var tasks = [];

          $.each(arguments, function(element, i) {
            $.each(i[0].rows, function(y) {
              var exists = function(doc) { return doc._id === i[0].rows[y].id; };
              if (arraySubset(tagsFromUrl(), i[0].rows[y].doc.tags) &&
                  !arrayAny(tasks, exists)) {
                tasks.push(i[0].rows[y].doc);
              }
            });
          });
          renderTasksList(tasks, tags, false);
        });
      }
    });
  }


  function renderTasksList(tasks, tags, paginate, end) {

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
        date.setDate(date.getDate() + 1);
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
    $('.checker', rendered).bind('change', markDone);

    $.each(tags, function(_, obj) {
      obj.active = !($.inArray(obj.tag, tagsFromUrl()) === -1);
    });

    var renderedTags =
      $('<div>' + Mustache.to_html($('#tags_tpl').html(), {tags: tags}) +
        '</div>');

    $('#filter_tags').empty().append(renderedTags.children());
    $('#tasks_wrapper').empty().append(rendered.children());

    if (paginate) {
      var wrapper = $('<div id="load_btn_wrapper" />');
      var btn = $('<button id="load_more_btn"></button>');

      if (end) {
        btn.text("No More Tasks");
      } else {
        btn.addClass('active').text("Load More Tasks").bind('mousedown', function() {
          currentLimit += 20;
          updateTaskList();
          btn.text("Loading");
        });
      }

      btn.appendTo(wrapper);
      wrapper.appendTo($('#tasks_wrapper'));
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

  /*
   * Update filter url, adding or removing the key as needed
   */
  function updateFilterUrl(key) {
    var keys = arrayToggle(tagsFromUrl(), key);
    document.location.hash = '#/' + ((keys.length) ? 'tags/' + keys.join(',') : '');
  }


  /*
   * If a key is in the array, remove it, otherwise add it
   */
  function arrayToggle(arr, key) {
    if ($.inArray(key, arr) === -1) {
      arr.push(key);
    } else {
      arr = $.grep(arr, function(x) { return x !== key; });
    }
    return arr;
  }


  /*
   * Returns a list of tags that are specified in the current url under
   * the #/tags/ uri
   */
  function tagsFromUrl() {
    var match = router.matchesCurrent('#/tags/*test');
    return $.grep(match[1].split(','), function(x) { return x !== ''; });
  }


  /*
   * Return true if any of the items in the array satifies the anyFun predicate
   */
  function arrayAny(arr, anyFun) {
    for(var obj in arr) {
      if (anyFun(arr[obj])) {
        return true;
      }
    }
    return false;
  }


  /*
   * Naive implementation to check that arr1 is a full subset of arr2
   */
  function arraySubset(arr1, arr2) {
    var i = 0;
    $.each(arr1, function(_, val) {
      if ($.inArray(val, arr2) !== -1) {
        ++i;
      }
    });
    return i === arr1.length;
  }


  /*
   * Each task is given a numerical index which defines what order they
   * should be displayed in, when we reorder something calculate its index
   * based on the surrounding tasks
   */
  function createIndex(el) {

    var before = el.prev('li.task');
    var after = el.next('li.task');

    if (before.length === 0 && after.length === 0) {
      return false;
    } else if (before.length === 0) {
      return after.data('index') + 1;
    } else if (after.length === 0) {
      return before.data('index') - 1;
    } else {
      return (before.data('index') + after.data('index')) / 2;
    }
  }


  /*
   * Wrapper function for cross browser transforms
   */
  function transformX(dom, x) {
    if (Modernizr.csstransforms3d) {
      dom.css("-moz-transform", "translate3d(" + x + "px, 0, 0)")
        .css("-webkit-transform", "translate3d(" + x + "px, 0, 0)");
    } else {
      dom.css("-moz-transform", "translate(" + x + "px, 0)")
        .css("-webkit-transform", "translate(" + x + "px, 0)");
    }
  }


  /*
   * Android makes butt ugly checkboxes, so we just make our own with images
   * initialises checkboxes for everything inside 'parent', this needs to be
   * run on anything dynamically put into DOM
   */
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


  /*
   * Given a string "a random string #with #tags" parse out the hash tags
   * and return the tags and plain string seperately
   */
  function extractHashTags(text) {

    var matches = text.match(/\#([\w\-\.]*[\w]+[\w\-\.]*)/g) || [];
    var tags = $.map(matches, function(tag) { return tag.slice(1); });

    return {
      tags: tags,
      text: text.replace(/\#([\w\-\.]*[\w]+[\w\-\.]*)/g, '').trim()
    };
  }


  /*
   * What it says on the tin
   */
  function formatDate(date) {
    var d = date.getDate();
    var prefix = (d === 1) ? 'st' : (d === 2) ? 'nd' : (d === 3) ? 'rd' : 'th';
    return days[date.getDay()] + " " + date.getDate() + prefix +
      " of " + months[date.getMonth()];
  }


  /*
   * Fetches the current set of tags from a CouchDB view, for every tag we
   * ensure there is a corresponding style definition for its colour
   */
  function getTags() {

    var dfd = $.Deferred();

    $db.view('couchtasks/tags', {group: true}).then(function(data) {
      var i = 0, css = [], tags = [];
      $.each(data.rows, function(_, tag) {
        css.push('.tag_' + tag.key[0] + ' { background: ' + tagColors[i++] + ' }');
        tags.push({tag: tag.key[0], count: tag.value});
      });

      $("#tag_defs").html(css.join('\n'));
      dfd.resolve(tags);
    });

    return dfd.promise();
  };


  /*
   * Handles any incoming real time changes from CouchDB, this will either
   * trigger a full page load if the design doc has changed, or update
   * the current list of tasks if needed
   */
  function handleChanges() {

    $changes = $db.changes();
    $changes.onChange(function(changes) {

      var doRefresh = false;

      $.each(changes.results, function(_, change) {

        // Full refresh if design doc changes
        if (/^_design/.test(change.id)) {
          document.location.reload();
        }

        // Otherwise check for changes that we didnt cause
        if (!doRefresh && $.inArray(change.id, myChanges) === -1) {
          doRefresh = true;
          myChanges = [];
        }

      });

      if (doRefresh && router.matchesCurrent('#/tags/*test')) {
        updateTaskList();
      }

    });
  }


  // the animation stuff needs to know the width of the browser
  $(window).bind('resize', function () {
    paneWidth = $('body').width();
  }).trigger('resize');


  // The layout wont let me put the submit button inside the form
  // proxy the submit button
  $('#save_task_btn').bind('click', function (e) {
    $('#edit_task_form').trigger('submit');
  });


  $('#show_filters_btn').bind('click', function (e) {

    var $filter_ui = $('#filter_tags');
    var visible = !$filter_ui.is(":visible");

    localJSON.set('showFilters', visible);
    $filter_ui[visible ? 'show' : 'hide']();

  });


  // Only start handling real time updates after a delay to get round
  // a silly bug in webkit that shows a page as still loading if ajax
  // requests are made before the whole page has loaded
  setTimeout(handleChanges, 5000);

  // Lets start this baby
  router.init(window);

  $('body').noisy({
    intensity: 1,
    size: 200,
    monochrome: false
  });

})();
